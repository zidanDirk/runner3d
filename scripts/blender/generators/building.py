"""Seeded residential/office facades, batched into four material primitives."""
from core.geometry import box, join_parts, mesh_object


def window_geometry(context, width, depth, height, bottom, top):
    asset = context.asset
    floors, columns = asset["floors"], asset["windowsPerFloor"]
    office = asset["variant"] == "office"
    vertices, faces, indices = [], [], []
    floor_pitch = (top - bottom) / floors
    # Quads sit just outside the facade, well inside the roof/foundation bounds.
    offset_x = width * 0.485 + min(width, depth) * 0.001
    offset_y = depth * 0.485 + min(width, depth) * 0.001
    for side in range(4):
        span = width if side < 2 else depth
        pitch = span * 0.82 / columns
        window_width = pitch * (0.88 if office else 0.49)
        window_height = floor_pitch * (0.57 if office else 0.42)
        for floor in range(floors):
            centre_z = bottom + floor_pitch * (floor + 0.53)
            for column in range(columns):
                centre = -span * 0.41 + pitch * (column + 0.5)
                x0, x1 = centre - window_width / 2, centre + window_width / 2
                z0, z1 = centre_z - window_height / 2, centre_z + window_height / 2
                if side == 0:  # -Y, exported +Z front
                    quad = [(x0, -offset_y, z0), (x1, -offset_y, z0),
                            (x1, -offset_y, z1), (x0, -offset_y, z1)]
                elif side == 1:
                    quad = [(x1, offset_y, z0), (x0, offset_y, z0),
                            (x0, offset_y, z1), (x1, offset_y, z1)]
                elif side == 2:
                    quad = [(offset_x, x0, z0), (offset_x, x1, z0),
                            (offset_x, x1, z1), (offset_x, x0, z1)]
                else:
                    quad = [(-offset_x, x1, z0), (-offset_x, x0, z0),
                            (-offset_x, x0, z1), (-offset_x, x1, z1)]
                start = len(vertices)
                vertices.extend(quad)
                faces.append(tuple(range(start, start + 4)))
                # Ensure even the smallest valid building uses both shared window
                # materials, then use only the independent per-id PRNG thereafter.
                index = len(indices)
                warm = context.rng.random() < (0.25 if office else 0.52)
                indices.append(0 if index == 0 else 1 if index == 1 else int(warm))
    return mesh_object(f"{context.prefix}_windows", vertices, faces,
                       [context.palette["window"], context.palette["warm_window"]], indices)


def generate(context):
    asset, palette, name = context.asset, context.palette, context.prefix
    width, depth, height = asset["width"], asset["depth"], asset["height"]
    roof_style = asset["roofStyle"]
    roof_space = min(1.2, height * 0.1) if roof_style != "flat" else 0
    wall_height = height - roof_space
    trim_height = min(height * 0.025, 0.24)
    floor_pitch = (wall_height - 2 * trim_height) / asset["floors"]
    parts = [
        box(f"{name}_foundation", (0, 0, trim_height / 2),
            (width, depth, trim_height), palette["trim"]),
        box(f"{name}_body", (0, 0, wall_height / 2),
            (width * 0.97, depth * 0.97, wall_height - 2 * trim_height), palette["body"]),
        box(f"{name}_roof", (0, 0, wall_height - trim_height / 2),
            (width, depth, trim_height), palette["trim"]),
    ]
    if asset["variant"] == "office":
        # One thin geometric ribbon per floor makes the office variant readable.
        # The ribbons share the existing trim material; they add no draw calls.
        for floor in range(1, asset["floors"]):
            parts.append(box(f"{name}_floor_{floor}", (0, 0, trim_height + floor * floor_pitch),
                             (width * 0.985, depth * 0.985, min(floor_pitch * 0.08, 0.12)),
                             palette["trim"]))
    parts.append(window_geometry(context, width, depth, height,
                                 trim_height, wall_height - trim_height))
    if roof_style == "equipment":
        # A raised service enclosure + three vent fins make the silhouette distinct.
        parts.append(box(f"{name}_plant", (0, 0, wall_height + roof_space / 2),
                         (width * 0.52, depth * 0.48, roof_space), palette["trim"]))
        for index in range(3):
            parts.append(box(f"{name}_vent_{index}", ((index - 1) * width * 0.13, -depth * 0.25,
                             wall_height + roof_space * 0.55),
                             (width * 0.065, depth * 0.03, roof_space * 0.65), palette["body"]))
    elif roof_style == "terrace":
        parts.append(box(f"{name}_terrace", (0, 0, wall_height + roof_space * 0.12),
                         (width * 0.88, depth * 0.88, roof_space * 0.24), palette["trim"]))
        for side in (-1, 1):
            for axis in range(2):
                location = (side * width * 0.4, 0, height - roof_space * 0.09) if axis == 0 else (0, side * depth * 0.4, height - roof_space * 0.09)
                dimensions = (width * 0.035, depth * 0.83, roof_space * 0.18) if axis == 0 else (width * 0.83, depth * 0.035, roof_space * 0.18)
                parts.append(box(f"{name}_terrace_rail_{axis}_{side}", location, dimensions, palette["trim"]))
                post_location = (side * width * 0.4, 0, wall_height + roof_space / 2) if axis == 0 else (0, side * depth * 0.4, wall_height + roof_space / 2)
                parts.append(box(f"{name}_terrace_post_{axis}_{side}", post_location,
                                 (width * 0.035, depth * 0.035, roof_space), palette["trim"]))
    if asset["accentStyle"] == "neon":
        # Shared luminous facade strips and roof bars, no added materials or lights.
        for side in (-1, 1):
            for edge in (-1, 1):
                parts.append(box(f"{name}_neon_strip_{side}_{edge}",
                                 (edge * width * 0.43, side * depth * 0.488, wall_height * 0.55),
                                 (width * 0.025, depth * 0.015, wall_height * 0.77), palette["window"]))
            parts.append(box(f"{name}_roof_signal_{side}",
                             (0, side * depth * 0.37, wall_height - trim_height * 0.28),
                             (width * 0.88, depth * 0.035, trim_height * 0.4), palette["warm_window"]))
    return join_parts(parts, name)
