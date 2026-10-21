"""20-bone rest skeleton derived from the generated character's real pivots."""
from mathutils import Vector


JOINT_BONES = {"center": "Hips", "neck": "Neck", "head": "Head"}
for _side in ("Left", "Right"):
    for _joint, _bone in (("Shoulder", "UpperArm"), ("Elbow", "LowerArm"), ("Wrist", "Hand"),
                          ("Hip", "UpperLeg"), ("Knee", "LowerLeg"), ("Ankle", "Foot")):
        JOINT_BONES[f"{_side.lower()}{_joint}"] = f"{_side}{_bone}"


def skeleton_spec(builder):
    origins = {name: obj.matrix_world.translation.copy() for name, obj in builder.parts.items()}
    scale = builder.s
    hips, spine, neck, head = (origins[name] for name in ("Pelvis", "Torso", "Neck", "Head"))
    chest = spine.lerp(neck, .50)
    spec = [("Root", None, Vector((0, 0, 0)), Vector((0, 0, .08*scale))),
            ("Hips", "Root", hips, spine),
            ("Spine", "Hips", spine, chest),
            ("Chest", "Spine", chest, neck),
            ("Neck", "Chest", neck, head),
            ("Head", "Neck", head, Vector((0, 0, builder.height-.02*scale)))]
    shoulder_center = origins["LeftUpperArm"].lerp(origins["RightUpperArm"], .5)
    for side in ("Left", "Right"):
        shoulder, elbow, wrist = (origins[f"{side}{part}"] for part in ("UpperArm", "LowerArm", "Hand"))
        spec.extend([(f"{side}Shoulder", "Chest", shoulder_center, shoulder),
                     (f"{side}UpperArm", f"{side}Shoulder", shoulder, elbow),
                     (f"{side}LowerArm", f"{side}UpperArm", elbow, wrist),
                     (f"{side}Hand", f"{side}LowerArm", wrist, wrist+Vector((0, .004*scale, -.12*scale)))])
    for side in ("Left", "Right"):
        hip, knee, ankle = (origins[f"{side}{part}"] for part in ("UpperLeg", "LowerLeg", "Foot"))
        spec.extend([(f"{side}UpperLeg", "Hips", hip, knee),
                     (f"{side}LowerLeg", f"{side}UpperLeg", knee, ankle),
                     (f"{side}Foot", f"{side}LowerLeg", ankle, ankle+Vector((0, .18*scale, -.10*scale)))])
    return spec
