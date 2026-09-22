from pathlib import Path
import os
import subprocess
import tempfile
import textwrap

ROOT = Path(__file__).resolve().parent.parent
RENDERER = ROOT / "platform" / "render.py"

VALID = """
name: job-asset-service
type: web
port: 8080
replicas: 2
build:
  strategy: dockerfile
"""


def run_case(name, contract, should_pass, image=None):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        contract_path = tmp / "platform.yaml"
        output_path = tmp / "manifest.yaml"

        contract_path.write_text(
            textwrap.dedent(contract).strip() + "\n"
        )

        env = os.environ.copy()
        env["PLATFORM_CONTRACT_PATH"] = str(contract_path)
        env["RENDER_OUTPUT_PATH"] = str(output_path)
        env["IMAGE_URI"] = (
            image
            or "example.invalid/tvp/job-asset-service:abc123"
        )

        result = subprocess.run(
            ["python3", str(RENDERER)],
            env=env,
            text=True,
            capture_output=True,
        )

        passed = result.returncode == 0

        if passed != should_pass:
            print(f"FAIL: {name}")
            print(result.stdout)
            print(result.stderr)
            raise SystemExit(1)

        if should_pass:
            manifest = output_path.read_text()

            required_defaults = [
                "resources:",
                "readinessProbe:",
                "livenessProbe:",
            ]

            for expected in required_defaults:
                if expected not in manifest:
                    print(
                        f"FAIL: {name}: "
                        f"missing {expected}"
                    )
                    raise SystemExit(1)

            print(f"PASS: {name}")
        else:
            message = (
                result.stdout + result.stderr
            ).strip()

            print(
                f"PASS: {name} "
                f"-> rejected: {message}"
            )


run_case(
    "valid contract",
    VALID,
    True,
)

run_case(
    "replicas zero",
    VALID.replace("replicas: 2", "replicas: 0"),
    False,
)

run_case(
    "replicas too large",
    VALID.replace("replicas: 2", "replicas: 100"),
    False,
)

run_case(
    "invalid low port",
    VALID.replace("port: 8080", "port: 0"),
    False,
)

run_case(
    "invalid high port",
    VALID.replace("port: 8080", "port: 70000"),
    False,
)

run_case(
    "unsupported workload type",
    VALID.replace("type: web", "type: worker"),
    False,
)

run_case(
    "unsupported build strategy",
    VALID.replace(
        "strategy: dockerfile",
        "strategy: buildpack",
    ),
    False,
)

run_case(
    "invalid kubernetes name",
    VALID.replace(
        "name: job-asset-service",
        "name: Job_Asset_Service",
    ),
    False,
)

run_case(
    "mutable latest image",
    VALID,
    False,
    image="example.invalid/tvp/job-asset-service:latest",
)

print()
print("ALL GUARDRAIL TESTS PASSED")
