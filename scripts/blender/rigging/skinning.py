"""Explicit normalized vertex weights; no automatic heat weights or parenting trick."""
from mathutils import Matrix


def clamp(value):
    return max(0.0, min(1.0, value))


def smooth(value):
    value = clamp(value)
    return value*value*(3-2*value)


def segment_position(point, bone):
    direction = bone.tail_local - bone.head_local
    return (point-bone.head_local).dot(direction)/direction.length_squared


def weights_for(name, point, rig, scale):
    bones = rig.data.bones
    if name == "Pelvis":
        return {"Hips": 1.0}
    if name in {"Head", "Hair"}:
        return {"Head": 1.0}
    if name in {"Neck", "Backpack"}:
        return {"Neck" if name == "Neck" else "Chest": 1.0}
    if name == "Torso":
        waist = smooth((point.z-bones["Hips"].head_local.z-.025*scale)/(.08*scale))
        chest = smooth((point.z-bones["Spine"].head_local.z)/
                       (bones["Chest"].head_local.z-bones["Spine"].head_local.z+.065*scale))
        return {"Hips": 1-waist, "Spine": waist*(1-chest), "Chest": waist*chest}
    side = "Left" if name.startswith("Left") else "Right"
    part = name[len(side):]
    if part in {"Hand", "Foot"}:
        return {name: 1.0}
    position = segment_position(point, bones[name])
    weights = {name: 1.0}
    if part in {"UpperArm", "UpperLeg"}:
        parent = f"{side}Shoulder" if part == "UpperArm" else "Hips"
        child = f"{side}{'LowerArm' if part == 'UpperArm' else 'LowerLeg'}"
        proximal = .35*(1-smooth(position/.20))
        distal = .45*smooth((position-.78)/.22)
        weights = {name: 1-proximal-distal, parent: proximal, child: distal}
    elif part in {"LowerArm", "LowerLeg"}:
        parent = f"{side}{'UpperArm' if part == 'LowerArm' else 'UpperLeg'}"
        proximal = .45*(1-smooth(position/.22))
        weights = {name: 1-proximal, parent: proximal}
    weights = {bone: weight for bone, weight in weights.items() if weight > 1e-8}
    total = sum(weights.values())
    return {bone: weight/total for bone, weight in weights.items()}


def bind_skin(builder, rig):
    # Mesh vertices are rest-world positions under identity Armature object. The
    # modifier provides actual deformation; no Mesh is parented to a pose bone.
    for name, obj in builder.parts.items():
        matrix = obj.matrix_world.copy()
        positions = [matrix @ vertex.co for vertex in obj.data.vertices]
        obj.parent = rig
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Identity(4)
        for vertex, point in zip(obj.data.vertices, positions, strict=True):
            vertex.co = point
        obj.data.update()
        groups = {bone.name: obj.vertex_groups.new(name=bone.name) for bone in rig.data.bones}
        for vertex in obj.data.vertices:
            for bone, weight in weights_for(name, vertex.co, rig, builder.s).items():
                groups[bone].add([vertex.index], weight, "REPLACE")
        modifier = obj.modifiers.new("runner_skin", "ARMATURE")
        modifier.object = rig
        modifier.use_vertex_groups = True
        modifier.use_bone_envelopes = False
        modifier.use_deform_preserve_volume = False
    builder.root["character"]["schemaVersion"] = 2
    builder.root["character"]["bones"] = {bone.name: bone.name for bone in rig.data.bones}
