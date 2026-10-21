"""An inexpensive warm city lamp; emission is visual, never a real light object."""
from core.geometry import box, join_parts


def generate(context):
    asset, palette, name = context.asset, context.palette, context.prefix
    height, base, arm = asset["height"], asset["baseSize"], asset["armLength"]
    width = arm + base
    pole_x = -arm / 2
    base_height = min(height * 0.06, base * 0.4)
    pole_width = base * 0.16
    arm_thickness = base * 0.15
    hood_length = min(base * 0.78, width * 0.42)
    hood_depth, hood_height = base * 0.72, base * 0.18
    hood_x = width / 2 - hood_length / 2
    hood_top = height - arm_thickness
    arm_left = pole_x - pole_width / 2
    arm_right = width / 2 - hood_length * 0.25
    parts = [
        box(f"{name}_foot", (pole_x, 0, base_height / 2),
            (base, base, base_height), palette["base"], bevel=base * 0.035),
        box(f"{name}_pole", (pole_x, 0, (base_height + height - arm_thickness) / 2),
            (pole_width, pole_width, height - arm_thickness - base_height), palette["metal"]),
        box(f"{name}_arm", ((arm_left + arm_right) / 2, 0, height - arm_thickness / 2),
            (arm_right - arm_left, pole_width, arm_thickness), palette["metal"]),
        box(f"{name}_hood", (hood_x, 0, hood_top - hood_height / 2),
            (hood_length, hood_depth, hood_height), palette["base"], bevel=base * 0.025),
        box(f"{name}_diffuser", (hood_x, 0, hood_top - hood_height - base * 0.025),
            (hood_length * 0.83, hood_depth * 0.82, base * 0.05), palette["lamp"]),
    ]
    if asset["style"] == "tech":
        # A geometric luminous frame and mast strip share the lamp material.
        frame_left, frame_right = hood_x - hood_length * 0.45, width / 2
        frame_bottom = height - base * 1.1
        frame_top = height - base * 0.15
        for index, x in enumerate((frame_left, frame_right - pole_width / 2)):
            parts.append(box(f"{name}_frame_{index}", (x, 0, (frame_bottom + frame_top) / 2),
                             (pole_width, pole_width, frame_top - frame_bottom), palette["lamp"]))
        parts.append(box(f"{name}_frame_lower", ((frame_left + frame_right) / 2, 0, frame_bottom),
                         (frame_right - frame_left, pole_width, pole_width), palette["lamp"]))
        parts.append(box(f"{name}_mast_strip", (pole_x, -pole_width * 0.52, height * 0.49),
                         (pole_width * 0.45, pole_width * 0.1, height * 0.57), palette["lamp"]))
    return join_parts(parts, name)
