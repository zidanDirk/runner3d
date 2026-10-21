"""Parameterised Task 2 roadblock, preserving the original default silhouette."""
from core.geometry import box, clip_polygon, join_parts, mesh_object


def warning_stripes(name, material):
    """Clipped warning polygons on both faces; no downloaded image or UV layer."""
    vertices = []
    faces = []
    for side in (-1, 1):
        for index in range(9):
            left = -1.55 + index * 0.37
            z0, z1 = 0.405, 0.805
            polygon = [(left, z0), (left + 0.18, z0),
                       (left + 0.18 + 0.23, z1), (left + 0.23, z1)]
            polygon = clip_polygon(polygon, 0, -0.955, True)
            polygon = clip_polygon(polygon, 0, 0.955, False)
            if len(polygon) < 3:
                continue
            indices = list(range(len(vertices), len(vertices) + len(polygon)))
            vertices.extend((x, side * 0.073, z) for x, z in polygon)
            # CCW in X/Z faces -Y, which becomes the Three.js +Z front face.
            faces.append(indices if side == -1 else list(reversed(indices)))
    return mesh_object(name, vertices, faces, [material])


def generate(context):
    palette, name = context.palette, context.prefix
    parts = []
    for side in (-1, 1):
        parts.append(box(f"{name}_foot_{'left' if side == -1 else 'right'}", (side * 0.72, 0, 0.045),
                         (0.42, 0.9, 0.09), palette["base"], bevel=0.018))
        parts.append(box(f"{name}_support_{'left' if side == -1 else 'right'}", (side * 0.72, 0, 0.275),
                         (0.1, 0.13, 0.45), palette["white"], bevel=0.012))
    parts.append(box(f"{name}_board", (0, 0, 0.605), (2.0, 0.14, 0.49),
                     palette["orange"], bevel=0.018))
    parts.append(warning_stripes(f"{name}_warning", palette["white"]))
    result = join_parts(parts, name)
    # Parameterisation operates on the original authored mesh, not a compensating
    # scene transform. It preserves Task 2's bevel/stripe proportions on every axis.
    ratios = (context.asset["width"] / 2, context.asset["depth"] / 0.9,
              context.asset["height"] / 0.85)
    for vertex in result.data.vertices:
        for axis in range(3):
            vertex.co[axis] *= ratios[axis]
    result.data.update()
    return result
