"""Native low-poly geometry. Metres: Blender X wide / Y deep / Z up."""
from math import cos, sin, tau

import bpy


def box(name, location, dimensions, material, bevel=0.0):
    """A flat-shaded box, optionally with the Task 2 single-segment edge bevel."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new("low_poly_edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in obj.data.polygons:
        face.use_smooth = False
    return obj


def mesh_object(name, vertices, faces, materials, material_indices=None):
    """Batch decorative polygons into a single object with shared material slots."""
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for material in materials:
        mesh.materials.append(material)
    if material_indices is not None:
        for polygon, index in zip(mesh.polygons, material_indices, strict=True):
            polygon.material_index = index
    for polygon in mesh.polygons:
        polygon.use_smooth = False
    return obj


def ring_mesh(name, rings, segments, materials, band_materials):
    """Capped polygonal cone/frustum with material changes between shared rings."""
    vertices = [(radius * cos(tau * index / segments), radius * sin(tau * index / segments), z)
                for z, radius in rings for index in range(segments)]
    faces = [tuple(reversed(range(segments)))]
    indices = [band_materials[0]]
    for ring_index in range(len(rings) - 1):
        for index in range(segments):
            next_index = (index + 1) % segments
            lower = ring_index * segments
            upper = lower + segments
            faces.append((lower + index, lower + next_index, upper + next_index, upper + index))
            indices.append(band_materials[ring_index])
    faces.append(tuple(range((len(rings) - 1) * segments, len(rings) * segments)))
    indices.append(band_materials[-1])
    return mesh_object(name, vertices, faces, materials, indices)


def join_parts(parts, name):
    """One mesh at ground-centre origin, with all object transforms baked once."""
    if not parts:
        raise ValueError(f"{name}: generator did not create geometry")
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.data.name = f"{name}_mesh"
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return result


def clip_polygon(points, axis, boundary, keep_greater):
    """Clip a planar polygon, preserving the original roadblock stripe profile."""
    result = []
    for start, end in zip(points, points[1:] + points[:1]):
        start_inside = (start[axis] >= boundary) if keep_greater else (start[axis] <= boundary)
        end_inside = (end[axis] >= boundary) if keep_greater else (end[axis] <= boundary)
        if start_inside:
            result.append(start)
        if start_inside != end_inside:
            t = (boundary - start[axis]) / (end[axis] - start[axis])
            result.append(tuple(start[index] + t * (end[index] - start[index]) for index in range(2)))
    return result
