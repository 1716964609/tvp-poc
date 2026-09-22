from pathlib import Path
import os
import re
import yaml

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_CONTRACT_PATH = ROOT / "job-asset-service" / "platform.yaml"
DEFAULT_OUTPUT_PATH = ROOT / "k8s" / "base" / "job-asset-service.yaml"

contract_path = Path(
    os.environ.get("PLATFORM_CONTRACT_PATH", DEFAULT_CONTRACT_PATH)
)
output_path = Path(
    os.environ.get("RENDER_OUTPUT_PATH", DEFAULT_OUTPUT_PATH)
)


def reject(message):
    raise SystemExit(f"Guardrail violation: {message}")


def validate_config(config):
    if not isinstance(config, dict):
        reject("platform contract must be a YAML object")

    required = ["name", "type", "port", "replicas", "build"]

    for key in required:
        if key not in config:
            reject(f"missing required field: {key}")

    name = config["name"]

    if not isinstance(name, str):
        reject("name must be a string")

    if len(name) > 63:
        reject("name must be <= 63 characters")

    if not re.fullmatch(
        r"[a-z0-9](?:[-a-z0-9]*[a-z0-9])?",
        name,
    ):
        reject(
            "name must be a valid Kubernetes DNS-1123 label"
        )

    if config["type"] != "web":
        reject("only type=web is supported in TVP")

    build = config["build"]

    if not isinstance(build, dict):
        reject("build must be an object")

    if build.get("strategy") != "dockerfile":
        reject("unsupported build strategy")

    port = config["port"]

    if isinstance(port, bool) or not isinstance(port, int):
        reject("port must be an integer")

    if not 1 <= port <= 65535:
        reject("port must be between 1 and 65535")

    replicas = config["replicas"]

    if isinstance(replicas, bool) or not isinstance(replicas, int):
        reject("replicas must be an integer")

    if not 1 <= replicas <= 10:
        reject("replicas must be between 1 and 10")

    return {
        "name": name,
        "port": port,
        "replicas": replicas,
        "build_strategy": build["strategy"],
    }


def validate_image(image_uri):
    if not image_uri:
        reject("IMAGE_URI environment variable is required")

    if image_uri.endswith(":latest"):
        reject("mutable image tag ':latest' is not allowed")

    return image_uri


def render_manifest(name, port, replicas, image_uri):
    return f"""apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
spec:
  replicas: {replicas}
  selector:
    matchLabels:
      app: {name}
  template:
    metadata:
      labels:
        app: {name}
    spec:
      containers:
        - name: {name}
          image: {image_uri}
          ports:
            - containerPort: {port}
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /health
              port: {port}
            initialDelaySeconds: 2
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: {port}
            initialDelaySeconds: 10
            periodSeconds: 10

---

apiVersion: v1
kind: Service
metadata:
  name: {name}
spec:
  selector:
    app: {name}
  ports:
    - name: http
      port: 80
      targetPort: {port}
  type: ClusterIP
"""


def main():
    with contract_path.open() as f:
        config = yaml.safe_load(f)

    validated = validate_config(config)

    image_uri = validate_image(
        os.environ.get("IMAGE_URI")
    )

    manifest = render_manifest(
        validated["name"],
        validated["port"],
        validated["replicas"],
        image_uri,
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_path.write_text(manifest)

    print(f"Rendered {output_path}")
    print(f"name={validated['name']}")
    print(f"port={validated['port']}")
    print(f"replicas={validated['replicas']}")
    print(
        f"build.strategy="
        f"{validated['build_strategy']}"
    )
    print(f"image={image_uri}")


if __name__ == "__main__":
    main()
