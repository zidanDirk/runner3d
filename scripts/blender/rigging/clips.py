"""In-place pose clips authored through Blender 5.2 layered Actions.

Only Hips has animated translation (vertical pose compression/bob). Game-engine
jump height and all world X/Z travel remain outside the exported animation.
"""
from math import cos, pi, radians, sin, sqrt, tau

import bpy
from mathutils import Matrix, Quaternion, Vector


FPS = 100
CLIPS = {"Idle": 2.0, "Run": .72, "Jump": .95, "Slide": .75}
RUN_SUPPORT = .44
RUN_STRIDE = .31
RUN_LIFT = .22
RUN_BOB = .02


def ease(value):
    value = max(0.0, min(1.0, value))
    return value*value*(3-2*value)


def interpolate(points, time):
    for (start, a), (end, b) in zip(points, points[1:]):
        if time <= end:
            fraction = ease((time-start)/(end-start))
            return a+(b-a)*fraction
    return points[-1][1]


def run_foot(cycle, scale):
    """Continuous-velocity support/return trajectory, not physical root travel.

    The return initially follows the planted foot backward, then accelerates
    forward and decelerates before contact. Matching both endpoint slopes avoids
    the old zero-speed swing meeting a 1.33m/s support segment abruptly.
    """
    if cycle <= RUN_SUPPORT:
        return (RUN_STRIDE*(1-2*cycle/RUN_SUPPORT)*scale, 0.0, 0.0)
    swing = (cycle-RUN_SUPPORT)/(1-RUN_SUPPORT)
    start, end = -RUN_STRIDE, RUN_STRIDE
    tangent = -2*RUN_STRIDE*(1-RUN_SUPPORT)/RUN_SUPPORT
    y = ((2*swing**3-3*swing**2+1)*start + (swing**3-2*swing**2+swing)*tangent
         + (-2*swing**3+3*swing**2)*end + (swing**3-swing**2)*tangent)
    envelope = sin(pi*swing)**2
    return y*scale, RUN_LIFT*envelope*scale, radians(6)*envelope


def run_contact_height(rig, scale):
    """Keep the wider stride inside each generated leg's real reachable length."""
    hips = rig.data.bones["Hips"].head_local.z
    height = hips-.075*scale
    for side in ("Left", "Right"):
        upper = rig.data.bones[f"{side}UpperLeg"]
        lower = rig.data.bones[f"{side}LowerLeg"]
        ankle = rig.data.bones[f"{side}Foot"].head_local
        reach = (upper.tail_local-upper.head_local).length+(lower.tail_local-lower.head_local).length-.010*scale
        horizontal = abs(ankle.y-upper.head_local.y)+RUN_STRIDE*scale
        lateral = ankle.x-upper.head_local.x
        safe = ankle.z+sqrt(max(.001, reach*reach-horizontal*horizontal-lateral*lateral))
        height = min(height, safe)
    return height


def solve_knee(hip, ankle, rest_hip, rest_knee, rest_ankle, sagittal_up=False):
    """Two-bone analytic IK using the actual generated limb lengths/bend plane."""
    upper = (rest_knee-rest_hip).length
    lower = (rest_ankle-rest_knee).length
    direction = ankle-hip
    distance = max(1e-7, min(direction.length, upper+lower-1e-7))
    axis = direction.normalized()
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    radius = sqrt(max(0.0, upper*upper-along*along))
    rest_axis = (rest_ankle-rest_hip).normalized()
    rest_projection = rest_hip+rest_axis*(rest_knee-rest_hip).dot(rest_axis)
    # The first real Slide render exposed crossed knees: the tiny inward X
    # component of a rest-pose pole grows during deep flexion. Keep Slide's knee
    # in its own sagittal plane; as the foot reaches forward this pole points up.
    pole = Vector((0, -axis.z, axis.y)) if sagittal_up else rest_knee-rest_projection
    if pole.length < 1e-7:
        pole = Vector((0, 1, 0))
    pole -= axis*pole.dot(axis)
    if pole.length < 1e-7:
        pole = Vector((0, 1, 0))-axis*axis.y
    return hip+axis*along+pole.normalized()*radius


def pose_parameters(name, phase, rig, scale):
    angles, targets, foot_angles = {}, {}, {}
    hip_height = rig.data.bones["Hips"].head_local.z
    hip_offset = 0.0
    lean = 0.0
    if name == "Idle":
        breathe = sin(tau*phase)
        lean = radians(.8)*breathe
        angles.update({"LeftUpperArm": radians(.8)*breathe, "RightUpperArm": -radians(.8)*breathe})
    elif name == "Run":
        hip_offset = run_contact_height(rig, scale)-hip_height+RUN_BOB*scale*sin(tau*phase)**2
        lean = radians(-9)
        for side, offset in (("Left", 0), ("Right", .5)):
            cycle = (phase+offset) % 1.0
            ankle = rig.data.bones[f"{side}Foot"].head_local.copy()
            travel, lift, pitch = run_foot(cycle, scale)
            ankle.y += travel
            ankle.z += lift
            foot_angles[side] = pitch
            targets[side] = ankle
            angles[f"{side}UpperArm"] = -radians(38)*cos(tau*cycle)
            angles[f"{side}LowerArm"] = radians(78+8*sin(tau*cycle))
    elif name == "Jump":
        # Match the newly grounded Run height at takeoff/landing. The airborne
        # pose remains unchanged and never adds upward Hips/root translation.
        run_offset = run_contact_height(rig, scale)-hip_height
        hip_offset = interpolate([(0, run_offset), (.10, run_offset-.01*scale), (.30, 0),
                                  (.55, 0), (.80, run_offset*.4), (1, run_offset)], phase)
        lean = interpolate([(0, -.06), (.10, -.13), (.30, -.05), (.55, .02), (.80, -.03), (1, -.10)], phase)
        arm = interpolate([(0, .20), (.10, 1.1), (.30, 1.6), (.55, 1.25), (.80, .75), (1, .35)], phase)
        elbow = interpolate([(0, .6), (.10, .75), (.30, .35), (.55, .70), (.80, .8), (1, .8)], phase)
        lift = interpolate([(0, 0), (.10, .03), (.30, .20), (.55, .28), (.80, .10), (1, 0)], phase)
        for side in ("Left", "Right"):
            angles[f"{side}UpperArm"] = arm
            angles[f"{side}LowerArm"] = elbow
            ankle = rig.data.bones[f"{side}Foot"].head_local.copy()
            ankle.y += .05*scale*sin(pi*phase)
            ankle.z += lift*scale
            targets[side] = ankle
    elif name == "Slide":
        hold = ease(phase/.16) if phase < .16 else (1-ease((phase-.80)/.20) if phase > .80 else 1)
        # Rest-pose endpoints raised the pelvis before entry and again after
        # exiting into Run. Use a neutral running compression/arm bend instead;
        # the low hold, physical slide window and whole-body scale stay intact.
        run_offset = run_contact_height(rig, scale)-hip_height
        hip_offset = run_offset*(1-hold)+(.18*scale-hip_height)*hold
        lean = radians(-9)*(1-hold)+radians(90)*hold
        angles.update({"Neck": radians(4.5)*(1-hold)+radians(-8)*hold,
                       "Head": radians(4.5)*(1-hold)+radians(-5)*hold})
        for side, reach in (("Left", .60), ("Right", .26)):
            angles[f"{side}UpperArm"] = radians(-12)*hold
            angles[f"{side}LowerArm"] = radians(78)*(1-hold)+radians(80)*hold
            ankle = rig.data.bones[f"{side}Foot"].head_local.copy()
            ankle.y += reach*scale*hold
            targets[side] = ankle
    angles["Spine"] = lean*.35
    angles["Chest"] = lean*.65
    if name != "Slide":
        angles["Neck"] = -lean*.5
        angles["Head"] = -lean*.5
    return hip_offset, angles, targets, foot_angles


def apply_pose(rig, name, phase, scale):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    if name == "Idle" and (phase == 0 or phase == 1):
        return
    hip_offset, angles, targets, foot_angles = pose_parameters(name, phase, rig, scale)
    overrides = {}
    for side, ankle in targets.items():
        upper = rig.data.bones[f"{side}UpperLeg"]
        lower = rig.data.bones[f"{side}LowerLeg"]
        hip = upper.head_local+Vector((0, 0, hip_offset))
        knee = solve_knee(hip, ankle, upper.head_local, lower.head_local,
                          rig.data.bones[f"{side}Foot"].head_local, sagittal_up=name == "Slide")
        overrides[upper.name] = (upper.tail_local-upper.head_local).rotation_difference(knee-hip)
        overrides[lower.name] = (lower.tail_local-lower.head_local).rotation_difference(ankle-knee)
        overrides[f"{side}Foot"] = Quaternion((1, 0, 0), foot_angles.get(side, 0))
    desired, rotations = {}, {}
    for bone in rig.data.bones:
        parent = bone.parent
        parent_rotation = rotations[parent.name] if parent else Quaternion()
        rotation = overrides.get(bone.name, parent_rotation @ Quaternion((1, 0, 0), angles.get(bone.name, 0)))
        if name == "Run":
            # Small counter-shoulder roll, with independent head stabilization.
            # All lateral displacement remains visual and above the fixed hips.
            # At phase .25 the left foot supports, so the torso shifts toward
            # -X; the opposite half-cycle mirrors that weight transfer.
            roll = -radians(1.6)*sin(tau*phase)
            if bone.name in {"Spine", "Chest"}:
                rotation = rotation @ Quaternion((0, 1, 0), roll*(.35 if bone.name == "Spine" else .65))
            elif bone.name == "Neck":
                rotation = parent_rotation.slerp(Quaternion(), .5)
            elif bone.name == "Head":
                rotation = Quaternion()
        head = (desired[parent.name] @ parent.matrix_local.inverted() @ bone.head_local
                if parent else bone.head_local.copy())
        if bone.name == "Hips":
            head += Vector((0, 0, hip_offset))
        matrix = Matrix.Translation(head) @ rotation.to_matrix().to_4x4() @ bone.matrix_local.to_3x3().to_4x4()
        desired[bone.name] = matrix
        rotations[bone.name] = rotation
        rest_relative = parent.matrix_local.inverted() @ bone.matrix_local if parent else bone.matrix_local
        pose_relative = desired[parent.name].inverted() @ matrix if parent else matrix
        basis = rest_relative.inverted() @ pose_relative
        pose_bone = rig.pose.bones[bone.name]
        pose_bone.rotation_quaternion = basis.to_quaternion().normalized()
        pose_bone.location = basis.to_translation() if bone.name == "Hips" else (0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def create_actions(rig, scale):
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    rig.animation_data_create()
    actions = {}
    for name, duration in CLIPS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig.animation_data.action = action
        # In 5.2 keyframe_insert creates a layered Action slot/channelbag. This
        # path was executed against installed 5.2.2 rather than legacy fcurves.
        phases = sorted({0, 1, .10, .16, .25, .30, .5, .55, .75, .80, .90,
                         *(index/8 for index in range(9))})
        if name == "Run":
            # 55.6Hz uniform samples plus mirrored contact/apex phases. The old
            # asymmetric set exported noticeably different left/right motion.
            base = {*(index/40 for index in range(41)), RUN_SUPPORT, (1+RUN_SUPPORT)/2}
            phases = sorted({round(point, 10) for point in {0, 1, *base, *((point+.5) % 1 for point in base)}})
        if name == "Slide":
            # Analytic foot IK is nonlinear during the fast entry/exit. Dense
            # authored keys there keep interpolation planted too, rather than
            # validating only a handful of coincident contact keyframes.
            phases = sorted({*phases, *(index/(duration*FPS) for index in range(76)
                                        if index <= 16 or index >= 56)})
        previous = {}
        for phase in phases:
            apply_pose(rig, name, phase, scale)
            frame = phase*duration*FPS
            for bone in rig.pose.bones:
                if bone.name == "Root":
                    continue
                quaternion = bone.rotation_quaternion.copy()
                if bone.name in previous and quaternion.dot(previous[bone.name]) < 0:
                    quaternion.negate()
                    bone.rotation_quaternion = quaternion
                previous[bone.name] = quaternion
                bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
                if bone.name == "Hips":
                    bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    channelbag = strip.channelbag(slot)
                    if channelbag is not None:
                        for curve in channelbag.fcurves:
                            for key in curve.keyframe_points:
                                key.interpolation = "LINEAR"
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = duration*FPS
        actions[name] = action
    rig.animation_data.action = actions["Idle"]
    rig.animation_data.action_slot = actions["Idle"].slots[0]
    bpy.context.scene.frame_set(0)
    apply_pose(rig, "Idle", 0, scale)
    bpy.context.view_layer.update()
    return actions
