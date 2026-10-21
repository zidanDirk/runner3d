"""Check each generated mesh and export selection-only glTF 2.0 GLB."""
from pathlib import Path

import bpy

from rigging.skeleton import JOINT_BONES


EXPORT_OPTIONS = {
    "export_format": "GLB",
    "use_selection": True,
    "export_yup": True,
    "export_materials": "EXPORT",
    "export_animations": False,
    "export_cameras": False,
    "export_lights": False,
    "export_extras": False,
    "export_texcoords": False,
    "export_normals": True,
    "export_apply": True,
    "export_attributes": False,
    "export_draco_mesh_compression_enable": False,
}

# Probed against Blender 5.2.2 RNA and installed io_scene_gltf2 5.2.40. Actions
# are layered slot/channelbag Actions; this is not the legacy NLA-only recipe.
CHARACTER_EXPORT_OPTIONS = {
    **EXPORT_OPTIONS,
    "export_extras": True,
    "export_apply": False,
    "export_skins": True,
    "export_animations": True,
    "export_animation_mode": "ACTIONS",
    "export_frame_range": False,
    "export_frame_step": 4,
    "export_force_sampling": False,
    "export_sampling_interpolation_fallback": "LINEAR",
    "export_def_bones": False,
    "export_armature_object_remove": False,
    "export_anim_single_armature": True,
    "export_bake_animation": False,
    "export_optimize_animation_size": True,
    "export_rest_position_armature": True,
    "export_current_frame": False,
    "export_morph_animation": False,
}


def verify_export_api():
    # Verified against the installed 5.2.2 RNA and io_scene_gltf2 source. A later
    # Blender version must be adopted explicitly, never silently guessed here.
    properties = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    missing = {"filepath", *EXPORT_OPTIONS, *CHARACTER_EXPORT_OPTIONS} - properties
    if missing:
        raise RuntimeError(f"Blender {bpy.app.version_string}: missing glTF API options {sorted(missing)}")


def measure_object(obj, contract):
    if contract["type"] == "character":
        return measure_character(obj, contract)
    if obj is None or obj.type != "MESH" or len(bpy.context.scene.objects) != 1:
        raise ValueError(f"{contract['id']}: generator must return exactly one scene mesh")
    if not obj.data.vertices or not obj.data.polygons:
        raise ValueError(f"{contract['id']}: generator returned empty geometry")
    if any(abs(value - expected) > 1e-7
           for values, expectations in ((obj.location, (0, 0, 0)), (obj.rotation_euler, (0, 0, 0)),
                                        (obj.scale, (1, 1, 1)))
           for value, expected in zip(values, expectations, strict=True)):
        raise ValueError(f"{contract['id']}: all object transforms must be applied")
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    # One axis conversion only: Blender (x,y,z) becomes glTF (x,z,-y).
    gltf_min = [minimum[0], minimum[2], -maximum[1]]
    gltf_max = [maximum[0], maximum[2], -minimum[1]]
    dimensions = [gltf_max[index] - gltf_min[index] for index in range(3)]
    tolerance = contract["tolerance"]
    if any(abs(measured - expected) > tolerance
           for measured, expected in zip(dimensions, contract["dimensions"], strict=True)):
        raise ValueError(f"{contract['id']}: dimensions {dimensions} != {contract['dimensions']}")
    if abs(gltf_min[1]) > tolerance or any(abs(gltf_min[axis] + gltf_max[axis]) > tolerance
                                         for axis in (0, 2)):
        raise ValueError(f"{contract['id']}: origin must be centred on the ground plane")
    obj.data.calc_loop_triangles()
    triangles = len(obj.data.loop_triangles)
    if triangles > contract["maxTriangles"]:
        raise ValueError(f"{contract['id']}: triangles {triangles} exceed {contract['maxTriangles']}")
    used = {face.material_index for face in obj.data.polygons}
    materials = [material.name for index, material in enumerate(obj.data.materials) if index in used]
    if set(materials) != set(contract["materials"]) or len(materials) != len(contract["materials"]):
        raise ValueError(f"{contract['id']}: material names {materials} != {contract['materials']}")
    if len(obj.data.materials) != len(materials):
        raise ValueError(f"{contract['id']}: unused material slots must be removed")
    return {"triangles": triangles, "dimensions": dimensions, "bounds": {"min": gltf_min, "max": gltf_max},
            "meshCount": 1, "materialCount": len(materials), "materials": sorted(materials)}


def world_bounds(objects):
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return {"min": [minimum[0], minimum[2], -maximum[1]],
            "max": [maximum[0], maximum[2], -minimum[1]]}


def measure_character(root, contract):
    """A character is the one explicit exception to the static one-Mesh kit.

    Named Mesh parts use a native 20-bone Armature and explicit normalized skin
    weights under a single ground-root Empty. Other asset types stay static.
    """
    if root is None or root.type != "EMPTY" or root.parent is not None:
        raise ValueError(f"{contract['id']}: character needs one root Empty")
    bpy.context.view_layer.update()
    descendants = list(root.children_recursive)
    meshes = [obj for obj in descendants if obj.type == "MESH"]
    rigs = [obj for obj in descendants if obj.type == "ARMATURE"]
    if not 17 <= len(meshes) <= 24 or len(rigs) != 1 or len(descendants) != len(meshes)+1:
        raise ValueError(f"{contract['id']}: expected only 17..24 named body Mesh parts")
    if set(bpy.context.scene.objects) != {root, *meshes, *rigs}:
        raise ValueError(f"{contract['id']}: character contains unrelated scene objects")
    if any(abs(value) > 1e-7 for value in (*root.location, *root.rotation_euler)):
        raise ValueError(f"{contract['id']}: character root must be identity at ground origin")
    for obj in (root, *meshes, *rigs):
        if any(abs(value) > 1e-7 for value in obj.rotation_euler) or any(abs(value-1) > 1e-7 for value in obj.scale):
            raise ValueError(f"{contract['id']}: {obj.name} needs unit scale and baked rotation")
    bounds = world_bounds(meshes)
    dimensions = [bounds["max"][axis] - bounds["min"][axis] for axis in range(3)]
    tolerance = contract["tolerance"]
    if any(abs(actual-expected) > tolerance for actual, expected in
           zip(dimensions, contract["dimensions"], strict=True)):
        raise ValueError(f"{contract['id']}: dimensions {dimensions} != {contract['dimensions']}")
    if abs(bounds["min"][1]) > tolerance or any(abs(bounds["min"][axis]+bounds["max"][axis]) > tolerance
                                               for axis in (0, 2)):
        raise ValueError(f"{contract['id']}: character bounds must centre X/Z and touch ground")
    metadata = root.get("character")
    if metadata is None or metadata.get("schemaVersion") != 2 or metadata.get("generator") != "humanoid-runner":
        raise ValueError(f"{contract['id']}: missing character reference metadata")
    parts = metadata.get("parts")
    if parts is None or set(parts.values()) != {obj.name for obj in meshes}:
        raise ValueError(f"{contract['id']}: part references must cover exactly the exported meshes")
    expected = {"Head", "Neck", "Torso", "Pelvis", "Hair", "LeftHand", "RightHand"}
    expected.update(f"{side}{part}" for side in ("Left", "Right")
                    for part in ("UpperArm", "LowerArm", "UpperLeg", "LowerLeg", "Foot"))
    if contract["accessories"]["backpack"]:
        expected.add("Backpack")
    if set(parts.keys()) != expected:
        raise ValueError(f"{contract['id']}: missing or extra semantic body parts")
    joint_parts = {"center": "Pelvis", "neck": "Neck", "head": "Head"}
    for side in ("Left", "Right"):
        for joint, part in (("Shoulder", "UpperArm"), ("Elbow", "LowerArm"), ("Wrist", "Hand"),
                            ("Hip", "UpperLeg"), ("Knee", "LowerLeg"), ("Ankle", "Foot")):
            joint_parts[f"{side.lower()}{joint}"] = f"{side}{part}"
    joints = metadata.get("joints")
    if joints is None or set(joints.keys()) != set(joint_parts):
        raise ValueError(f"{contract['id']}: invalid anatomical joint references")
    for key, part in joint_parts.items():
        origin = rigs[0].data.bones[JOINT_BONES[key]].head_local
        expected_origin = (origin.x, origin.z, -origin.y)
        if len(joints[key]) != 3 or any(abs(a-b) > 1e-7 for a, b in zip(joints[key], expected_origin, strict=True)):
            raise ValueError(f"{contract['id']}: {key} does not match actual {part} origin")
    triangles, primitive_count, materials = 0, 0, set()
    for obj in meshes:
        if not obj.data.vertices or not obj.data.polygons:
            raise ValueError(f"{contract['id']}: empty body part {obj.name}")
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        used = {face.material_index for face in obj.data.polygons}
        primitive_count += len(used)
        if len(used) != len(obj.data.materials):
            raise ValueError(f"{contract['id']}: unused material slots on {obj.name}")
        materials.update(material.name for material in obj.data.materials)
    if triangles > contract["maxTriangles"] or primitive_count > 40:
        raise ValueError(f"{contract['id']}: character geometry exceeds triangle/primitive budget")
    if materials != set(contract["materials"]):
        raise ValueError(f"{contract['id']}: character materials do not match contract")
    return {"triangles": triangles, "dimensions": dimensions, "bounds": bounds,
            "meshCount": len(meshes), "materialCount": len(materials), "materials": sorted(materials),
            "boneCount": len(rigs[0].data.bones)}


def export_glb(obj, contract, output_dir):
    report = measure_object(obj, contract)
    output = Path(output_dir) / f"{contract['id']}.glb"
    # The CLI restricts ids to path-free slugs; output is always in new staging.
    if output.exists():
        raise ValueError(f"Refusing to overwrite staging output {output}")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    options = EXPORT_OPTIONS
    if contract["type"] == "character":
        for child in obj.children_recursive:
            child.select_set(True)
        options = CHARACTER_EXPORT_OPTIONS
    bpy.context.view_layer.objects.active = obj
    result = bpy.ops.export_scene.gltf(filepath=str(output.resolve()), **options)
    if result != {"FINISHED"} or not output.is_file():
        raise RuntimeError(f"{contract['id']}: glTF export failed: {result}")
    report["fileBytes"] = output.stat().st_size
    if not 0 < report["fileBytes"] <= contract["maxBytes"]:
        raise ValueError(f"{contract['id']}: output size {report['fileBytes']} exceeds budget")
    return report
