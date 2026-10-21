"""Original City Runner: procedural geometry, native skin and four pose clips.

Blender +Y is the face/toe direction. The single exporter Y-up conversion makes
that glTF -Z, the game's forward direction. All sizes below are in metres.
"""
from math import cos, sin, tau

import bpy
from mathutils import Vector

from core.geometry import box, join_parts, mesh_object
from rigging.armature import create_armature
from rigging.clips import create_actions
from rigging.skinning import bind_skin
from rigging.validation import validate_rig


BEVELED_SECTION = ((-.7, -1), (.7, -1), (1, -.6), (1, .6),
                   (.7, 1), (-.7, 1), (-1, .6), (-1, -.6))


def profile(name, rings, material, segments=8, square=False):
    """Capped, tapered custom mesh; each ring has world centre and X/Y radii."""
    section = BEVELED_SECTION if square else tuple(
        (cos(tau * index / segments), sin(tau * index / segments))
        for index in range(segments))
    count = len(section)
    vertices = [(center[0] + x * rx, center[1] + y * ry, center[2])
                for center, rx, ry in rings for x, y in section]
    faces = [tuple(reversed(range(count)))]
    for level in range(len(rings) - 1):
        for index in range(count):
            following = (index + 1) % count
            faces.append((level * count + index, level * count + following,
                          (level + 1) * count + following, (level + 1) * count + index))
    faces.append(tuple(range((len(rings) - 1) * count, len(rings) * count)))
    return mesh_object(name, vertices, faces, [material])


def ellipsoid(name, center, radius, material, segments=8):
    """Faceted rounded volume, without a high-resolution sphere primitive."""
    return profile(name, [((center[0], center[1], center[2] - radius[2]), .2 * radius[0], .2 * radius[1]),
                          ((center[0], center[1], center[2] - .45 * radius[2]), .85 * radius[0], .85 * radius[1]),
                          (center, radius[0], radius[1]),
                          ((center[0], center[1], center[2] + .55 * radius[2]), .8 * radius[0], .8 * radius[1]),
                          ((center[0], center[1], center[2] + radius[2]), .25 * radius[0], .25 * radius[1])],
                   material, segments)


def joint_cap(name, center, radius, material):
    """A 32-triangle clothing joint volume merged into its existing limb Mesh."""
    return profile(name, [((center[0], center[1], center[2]-radius[2]), .45*radius[0], .45*radius[1]),
                          (center, radius[0], radius[1]),
                          ((center[0], center[1], center[2]+radius[2]), .45*radius[0], .45*radius[1])],
                   material, segments=6)


class RunnerBuilder:
    def __init__(self, context):
        self.context = context
        self.asset = context.asset
        self.name = context.prefix
        self.palette = context.palette
        self.s = self.asset["height"] / 1.75
        self.height = self.asset["height"]
        self.hip = self.height * self.asset["proportions"]["legLengthRatio"]
        self.head_height = .34 * self.s * self.asset["proportions"]["headScale"]
        self.head_bottom = self.height - .055 * self.s - self.head_height
        self.neck_base = self.head_bottom - .065 * self.s
        self.shoulder = self.neck_base - .035 * self.s
        # One bounded stylistic seed choice; no global RNG or asymmetric limbs.
        self.fringe_side = context.rng.choice((-1, 1))
        self.root = bpy.data.objects.new(f"{self.name}_Root", None)
        bpy.context.collection.objects.link(self.root)
        self.parts = {}
        self.origins = {"Root": Vector((0, 0, 0))}

    def box(self, label, center, dimensions, role, bevel=.006):
        return box(f"{self.name}_{label}", center, dimensions,
                   self.palette[role], bevel=bevel * self.s)

    def part(self, name, fragments, pivot, parent):
        """Bake vertices relative to a real anatomical pivot; preserve hierarchy."""
        # Single native custom meshes already have baked world vertices. Blender
        # join() warns when only one object is selected, so avoid that operator.
        if len(fragments) == 1:
            obj = fragments[0]
            obj.name = f"{self.name}_{name}"
            obj.data.name = f"{obj.name}_mesh"
        else:
            obj = join_parts(fragments, f"{self.name}_{name}")
        pivot = Vector(pivot)
        for vertex in obj.data.vertices:
            vertex.co -= pivot
        obj.data.update()
        obj.parent = self.root if parent == "Root" else self.parts[parent]
        obj.location = pivot - self.origins[parent]
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)
        self.parts[name] = obj
        self.origins[name] = pivot
        return obj

    def create_torso(self):
        s, hip = self.s, self.hip
        pelvis = profile(f"{self.name}_hips", [((0, 0, hip - .06*s), .19*s, .12*s),
                         ((0, 0, hip + .07*s), .205*s, .125*s)], self.palette["pants"], square=True)
        self.part("Pelvis", [pelvis], (0, 0, hip), "Root")
        chest_width = self.asset["proportions"]["shoulderWidth"] / 2 - .015*s
        torso = profile(f"{self.name}_jacket", [((0, 0, hip + .025*s), .20*s, .13*s),
                        ((0, 0, hip + .09*s), .19*s, .125*s),
                        ((0, 0, self.shoulder - .10*s), chest_width, .135*s),
                        ((0, 0, self.shoulder + .025*s), chest_width, .12*s),
                        ((0, 0, self.neck_base + .025*s), .10*s, .10*s)],
                        self.palette["jacket"], square=True)
        details = [torso,
                   self.box("hem", (0, 0, hip + .043*s), (.397*s, .262*s, .034*s), "pants", .008),
                   self.box("zip", (0, .137*s, (hip + self.neck_base)/2),
                            (.018*s, .012*s, (self.neck_base-hip)*.80), "shoe", .002),
                   self.box("collar", (0, 0, self.neck_base + .014*s),
                            (.205*s, .205*s, .06*s), "pants", .015),
                   self.box("chest_badge", (-.105*s, .141*s, self.shoulder-.105*s),
                            (.065*s, .012*s, .035*s), "shoe", .004)]
        # Back seams and a shoulder yoke remain legible in the running camera.
        details.append(self.box("back_yoke", (0, -.13*s, self.shoulder-.055*s),
                                (chest_width*1.65, .017*s, .034*s), "shoe", .005))
        self.part("Torso", details, (0, 0, hip+.09*s), "Pelvis")
        # Render review: fill the collar aperture and overlap the jaw naturally;
        # a narrow cylinder previously read as a dark, disconnected head seam.
        neck = profile(f"{self.name}_neck", [((0, 0, self.neck_base-.010*s), .087*s, .082*s),
                       ((0, 0, self.head_bottom+.055*s), .083*s, .079*s)], self.palette["skin"])
        self.part("Neck", [neck], (0, 0, self.neck_base), "Torso")

    def create_head(self):
        s, bottom, tall = self.s, self.head_bottom, self.head_height
        factor = self.asset["proportions"]["headScale"]
        rx, ry = .165*s*factor, .145*s*factor
        head = profile(f"{self.name}_face", [((0, .008*s, bottom), .65*rx, .68*ry),
                       ((0, .01*s, bottom+.20*tall), .90*rx, .93*ry),
                       ((0, 0, bottom+.58*tall), rx, ry),
                       ((0, -.008*s, bottom+.88*tall), .91*rx, .93*ry),
                       ((0, -.008*s, bottom+tall), .60*rx, .64*ry)],
                       self.palette["skin"], segments=12)
        face = [head]
        eye_z = bottom + .60*tall
        for side in (-1, 1):
            face.append(ellipsoid(f"{self.name}_ear", (side*.96*rx, -.006*s, bottom+.47*tall),
                                  (.035*s, .032*s, .056*s), self.palette["skin"]))
            face.append(self.box("eye", (side*.065*s, .146*s*factor, eye_z),
                                 (.035*s, .012*s, .036*s), "pants", 0))
            face.append(self.box("brow", (side*.065*s, .143*s*factor, eye_z+.038*s),
                                 (.052*s, .012*s, .014*s), "pants", 0))
        face.append(ellipsoid(f"{self.name}_nose", (0, .150*s*factor, bottom+.43*tall),
                              (.032*s, .042*s, .033*s), self.palette["skin"]))
        # Follow the actual faceted cheek surface instead of intersecting it with
        # a flat box (which only exposed two dots in the first rendered review).
        def cheek_y(x, height_fraction):
            blend = (height_fraction-.20)/.38
            ring_rx = rx * (.90 + .10*blend)
            ring_ry = ry * (.93 + .07*blend)
            return .01*s*(1-blend) + ring_ry - abs(x)*(ring_ry/ring_rx)*.2679491924
        smile_vertices = []
        for x in (-.035*s, -.0175*s, 0, .0175*s, .035*s):
            fraction = .255 + .035*(abs(x)/(.035*s))**2
            for edge in (-1, 1):
                z_fraction = fraction + edge*.0035*s/tall
                smile_vertices.append((x, cheek_y(x, z_fraction)+.002*s, bottom+z_fraction*tall))
        smile_faces = [(2*i+1, 2*i+3, 2*i+2, 2*i) for i in range(4)]
        face.append(mesh_object(f"{self.name}_smile", smile_vertices, smile_faces, [self.palette["pants"]]))
        self.part("Head", face, (0, 0, bottom+.025*s), "Neck")
        # A sloping fringe and a faceted crown, not a separate floating cube.
        hair_bottom = bottom + .70*tall
        crown = profile(f"{self.name}_hair_cap", [((0, -.015*s, hair_bottom), 1.01*rx, .98*ry),
                        ((0, -.018*s, bottom+.94*tall), 1.035*rx, 1.01*ry),
                        ((0, -.017*s, self.height-.018*s), .77*rx, .82*ry),
                        ((0, -.017*s, self.height), .42*rx, .50*ry)],
                        self.palette["pants"], segments=12)
        # The lower back trim follows the skull; the forehead stays open.
        fringe = self.box("fringe", (self.fringe_side*.025*s, .125*s*factor, bottom+.83*tall),
                          (.25*s*factor, .065*s, .057*s), "pants", .016)
        self.part("Hair", [crown, fringe], (0, 0, bottom+.025*s), "Head")

    def create_arm(self, side, label):
        s = self.s
        shoulder = Vector((side*self.asset["proportions"]["shoulderWidth"]/2, 0, self.shoulder))
        elbow = shoulder + Vector((side*.045*s, .012*s, -.255*s))
        wrist = shoulder + Vector((side*.060*s, .035*s, -.48*s))
        upper = profile(f"{self.name}_sleeve", [(elbow-Vector((0, 0, .018*s)), .073*s, .075*s),
                        (shoulder+Vector((0, 0, -.085*s)), .095*s, .095*s),
                        (shoulder+Vector((0, 0, .025*s)), .086*s, .083*s)], self.palette["jacket"])
        self.part(f"{label}UpperArm", [upper], shoulder, "Torso")
        forearm = profile(f"{self.name}_forearm", [(wrist, .057*s, .061*s),
                          (elbow-Vector((0, 0, .06*s)), .073*s, .073*s),
                          (elbow+Vector((0, 0, .018*s)), .073*s, .075*s)], self.palette["jacket"])
        cuff = profile(f"{self.name}_cuff", [(wrist-Vector((0, 0, .007*s)), .059*s, .063*s),
                       (wrist+Vector((0, 0, .025*s)), .061*s, .065*s)], self.palette["shoe"])
        cap = joint_cap(f"{self.name}_elbow_volume", elbow, (.073*s, .075*s, .068*s), self.palette["jacket"])
        self.part(f"{label}LowerArm", [forearm, cuff, cap], elbow, f"{label}UpperArm")
        hand = ellipsoid(f"{self.name}_hand", wrist-Vector((0, -.004*s, .055*s)),
                         (.060*s, .058*s, .076*s), self.palette["skin"])
        self.part(f"{label}Hand", [hand], wrist, f"{label}LowerArm")

    def create_shoe(self, side, label, ankle):
        s = self.s
        outline = ((-.060, -.25), (.060, -.25), (.103, -.18), (.112, .11), (.098, .21),
                   (.055, .25), (-.055, .25), (-.098, .21), (-.112, .11), (-.103, -.18))
        vertices, faces, indices = [], [], []
        levels = ((0, .94), (.027, 1), (.060, 1), (.135, .85), (.185, .62))
        n = len(outline)
        for level, shrink in levels:
            for x, y in outline:
                # The forefoot slopes down; the heel/ankle collar keeps volume.
                z = level if level <= .06 else level - max(0, y) * (.22 if level == .135 else .35)
                vertices.append((ankle[0]+x*s*shrink, y*s if level<=.06 else y*s*shrink,
                                 z*s))
        faces.append(tuple(reversed(range(n))))
        indices.append(1)
        for ring in range(len(levels)-1):
            for index in range(n):
                following = (index+1) % n
                faces.append((ring*n+index, ring*n+following, (ring+1)*n+following, (ring+1)*n+index))
                indices.append(1 if ring == 0 else 0)
        faces.append(tuple(range((len(levels)-1)*n, len(levels)*n)))
        indices.append(0)
        base = mesh_object(f"{self.name}_sneaker", vertices, faces,
                           [self.palette["shoe"], self.palette["pants"]], indices)
        details = [base,
                   self.box("shoe_heel", (ankle[0], -.172*s, .125*s),
                            (.12*s, .06*s, .055*s), "jacket", .011),
                   self.box("shoe_tongue", (ankle[0], .009*s, .181*s),
                            (.09*s, .105*s, .021*s), "jacket", .006)]
        for y in (.025, .070):
            details.append(self.box("lace", (ankle[0], y*s, (.17-y*.28)*s),
                                    (.105*s, .012*s, .010*s), "pants", 0))
        self.part(f"{label}Foot", details, ankle, f"{label}LowerLeg")

    def create_leg(self, side, label):
        s = self.s
        hip = Vector((side*.125*s, 0, self.hip))
        knee = Vector((side*.13*s, .006*s, .15*s+(self.hip-.15*s)*.53))
        ankle = Vector((side*.14*s, -.018*s, .15*s))
        thigh = profile(f"{self.name}_thigh", [(knee-Vector((0, 0, .02*s)), .077*s, .085*s),
                        (hip-Vector((0, 0, .10*s)), .103*s, .109*s),
                        (hip+Vector((0, 0, .025*s)), .102*s, .11*s)], self.palette["pants"])
        self.part(f"{label}UpperLeg", [thigh], hip, "Pelvis")
        shin = profile(f"{self.name}_shin", [(ankle-Vector((0, 0, .015*s)), .061*s, .065*s),
                       (ankle+(knee-ankle)*.62, .082*s, .080*s),
                       (knee+Vector((0, 0, .02*s)), .077*s, .085*s)], self.palette["pants"])
        cuff = profile(f"{self.name}_ankle_band", [(ankle, .064*s, .068*s),
                       (ankle+Vector((0, 0, .035*s)), .066*s, .070*s)], self.palette["jacket"])
        cap = joint_cap(f"{self.name}_knee_volume", knee, (.079*s, .082*s, .075*s), self.palette["pants"])
        self.part(f"{label}LowerLeg", [shin, cuff, cap], knee, f"{label}UpperLeg")
        self.create_shoe(side, label, ankle)

    def create_backpack(self):
        if not self.asset["accessories"]["backpack"]:
            return
        s = self.s
        center = Vector((0, -.17*s, self.shoulder-.13*s))
        body = self.box("backpack_body", center, (.29*s, .11*s, .31*s), "pants", .026)
        pocket = self.box("backpack_pocket", center+Vector((0, -.065*s, -.045*s)),
                          (.22*s, .010*s, .14*s), "jacket", .016)
        stripe = self.box("backpack_reflector", center+Vector((0, -.071*s, -.04*s)),
                          (.025*s, .008*s, .10*s), "shoe", .003)
        # Render review: strap ends now sit on the back yoke below the collar,
        # rather than sticking above the shoulders like two antennae.
        straps = [self.box("backpack_strap", (side*.14*s, -.123*s, self.shoulder-.09*s),
                           (.036*s, .026*s, .18*s), "pants", .007) for side in (-1, 1)]
        self.part("Backpack", [body, pocket, stripe, *straps], center, "Torso")

    def build(self):
        self.create_torso()
        self.create_head()
        for side, label in ((-1, "Left"), (1, "Right")):
            self.create_arm(side, label)
            self.create_leg(side, label)
        self.create_backpack()
        bpy.context.view_layer.update()
        joint_parts = {"center": "Pelvis", "neck": "Neck", "head": "Head"}
        for label in ("Left", "Right"):
            for joint, part in (("Shoulder", "UpperArm"), ("Elbow", "LowerArm"), ("Wrist", "Hand"),
                                ("Hip", "UpperLeg"), ("Knee", "LowerLeg"), ("Ankle", "Foot")):
                joint_parts[f"{label.lower()}{joint}"] = f"{label}{part}"
        joints = {}
        for key, part in joint_parts.items():
            actual = self.parts[part].matrix_world.translation
            joints[key] = [actual.x, actual.z, -actual.y]
        self.root["character"] = {"schemaVersion": 1, "generator": "humanoid-runner",
                                  "forward": [0, 0, -1], "joints": joints,
                                  "parts": {name: obj.name for name, obj in self.parts.items()}}
        return self.root


def generate(context):
    builder = RunnerBuilder(context)
    root = builder.build()
    rig = create_armature(builder)
    bind_skin(builder, rig)
    create_actions(rig, builder.s)
    validate_rig(root, rig, list(builder.parts.values()))
    return root
