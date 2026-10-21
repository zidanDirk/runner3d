"""Data-only batch entry point, invoked by Node in a pinned background Blender."""
import argparse
import json
from pathlib import Path
import sys

import bpy

# Fixed local imports only. The JSON job cannot select a Python file or function.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from core.context import BLENDER_VERSION, GENERATOR_VERSION, GenerationContext, reset_scene, validate_job  # noqa: E402
from core.exporter import export_glb, verify_export_api  # noqa: E402
from generators import billboard, building, humanoid_runner, powerup, roadblock, street_lamp, traffic_cone  # noqa: E402


GENERATORS = {
    "roadblock": roadblock.generate,
    "traffic-cone": traffic_cone.generate,
    "street-lamp": street_lamp.generate,
    "building": building.generate,
    "billboard": billboard.generate,
    "character": humanoid_runner.generate,
    "powerup": powerup.generate,
}


def parse_args():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Generate configured Runner3D models without a UI")
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    return parser.parse_args(arguments)


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON object key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"Non-finite JSON constant is not allowed: {value}")


def main():
    args = parse_args()
    if args.job.stat().st_size > 1024 * 1024:
        raise ValueError("Job file must not exceed 1 MiB")
    job = json.loads(args.job.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys,
                     parse_constant=reject_constant)
    validate_job(job)
    verify_export_api()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.iterdir()):
        raise ValueError("Output staging directory must be empty")
    print(f"[blender] Blender {bpy.app.version_string}; Python {sys.version.split()[0]}; "
          f"generator {GENERATOR_VERSION}; {len(job['assets'])} assets", flush=True)
    report = {"blenderVersion": BLENDER_VERSION, "generatorVersion": GENERATOR_VERSION, "assets": {}}
    for asset in job["assets"]:
        reset_scene()
        context = GenerationContext.create(asset, job["themes"][asset["themeId"]])
        model = GENERATORS[asset["type"]](context)
        measurements = export_glb(model, asset, output_dir)
        report["assets"][asset["id"]] = measurements
        print(f"[blender] {asset['id']}: {measurements['triangles']} triangles; "
              f"{measurements['fileBytes']} bytes; {measurements['dimensions']} m", flush=True)
    # No timestamps or random identifiers: same pinned exporter/job is repeatable.
    (output_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[blender] Batch complete: {output_dir}", flush=True)


if __name__ == "__main__":
    main()
