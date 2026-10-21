"""Create a deterministic native Blender Armature without a graphical UI."""
import bpy
from mathutils import Vector

from rigging.skeleton import skeleton_spec


def create_armature(builder):
    spec = skeleton_spec(builder)
    data = bpy.data.armatures.new(f"{builder.name}_Skeleton")
    rig = bpy.data.objects.new(f"{builder.name}_Armature", data)
    bpy.context.collection.objects.link(rig)
    rig.parent = builder.root
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in spec:
        bone = data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent is not None:
            bone.parent = data.edit_bones[parent]
        # Consistent bending plane on descending arms/legs. Quaternion animation
        # below still derives full transforms from actual rest matrices.
        bone.align_roll(Vector((0, -1 if tail.z > head.z else 1, 0)))
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    return rig
