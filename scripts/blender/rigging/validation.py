"""Real Blender-side rig, normalized weights and Action checks before export."""
from math import isfinite

import bpy

from rigging.clips import CLIPS, FPS
from rigging.skeleton import JOINT_BONES


def validate_rig(root, rig, meshes):
    if rig.type != "ARMATURE" or len(rig.data.bones) != 20:
        raise ValueError("City Runner requires the actual 20-bone Armature")
    names = set(rig.data.bones.keys())
    for obj in meshes:
        modifiers = [modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"]
        if len(modifiers) != 1 or modifiers[0].object != rig:
            raise ValueError(f"{obj.name}: missing actual Armature modifier")
        for vertex in obj.data.vertices:
            weights = [(obj.vertex_groups[entry.group].name, entry.weight) for entry in vertex.groups]
            if not weights or any(name not in names or not isfinite(weight) or weight < 0 for name, weight in weights):
                raise ValueError(f"{obj.name}: invalid vertex bone reference/weight")
            if abs(sum(weight for _, weight in weights)-1) > 1e-6:
                raise ValueError(f"{obj.name}: vertex weights are not normalized")
    metadata = root["character"]
    if metadata["schemaVersion"] != 2 or set(metadata["bones"].keys()) != names:
        raise ValueError("Character schema2 bone references do not match actual skeleton")
    for joint, name in JOINT_BONES.items():
        actual = rig.data.bones[name].head_local
        expected = (actual.x, actual.z, -actual.y)
        if any(abs(value-target) > 1e-6 for value, target in zip(metadata["joints"][joint], expected, strict=True)):
            raise ValueError(f"Character joint {joint} differs from real bone head")
    actions = {action.name: action for action in bpy.data.actions}
    if set(actions) != set(CLIPS):
        raise ValueError("Character must own exactly Idle, Run, Jump and Slide Actions")
    for name, action in actions.items():
        if abs(action.frame_range[0]) > 1e-7 or abs(action.frame_range[1]/FPS-CLIPS[name]) > 1e-6:
            raise ValueError(f"{name}: invalid actual Action frame range")
        curve_count = 0
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    bag = strip.channelbag(slot)
                    if bag is None:
                        continue
                    for curve in bag.fcurves:
                        rig.path_resolve(curve.data_path)
                        if 'bones["Root"]' in curve.data_path:
                            raise ValueError(f"{name}: root motion channel is forbidden")
                        if any(not isfinite(value) for key in curve.keyframe_points for value in key.co):
                            raise ValueError(f"{name}: non-finite animation keyframe")
                        curve_count += 1
        if curve_count == 0:
            raise ValueError(f"{name}: empty layered Action")
