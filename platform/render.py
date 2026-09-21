from pathlib import Path
import os
import yaml

ROOT = Path(__file__).resolve().parent.parent

contract_path = ROOT / "job-asset-service" / "platform.yaml"
output_path = ROOT / "k8s" / "base" / "job-asset-service.yaml"

with contract_path.open() as f:
    config = yaml.safe_load(f)

required = ["name", "type", "port", "replicas", "build"]

for key in required:
    if key not in config:
        raise SystemExit(f"Missing required field: {key}")

if config["type"] != "web":
    raise SystemExit("Only type=web is supported in TVP")

if config["build"].get("strategy") not in {"dockerfile"}:
    raise SystemExit("Unsupported build strategy")

image_uri = os.environ.get("IMAGE_URI")

if not image_uri:
    raise SystemExit("IMAGE_URI environment variable is required")

name = config["name"]
port = int(config["port"])
replicas = int(config["replicas"])

if replicas < 1:
    raise SystemExit("replicas must be >= 1")

manifest = f"""apiVersion: apps/v1
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

output_path.write_text(manifest)

print(f"Rendered {output_path}")
print(f"name={name}")
print(f"port={port}")
print(f"replicas={replicas}")
print(f"build.strategy={config['build']['strategy']}")
print(f"image={image_uri}")
