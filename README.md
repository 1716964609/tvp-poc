# TVP — Thinnest Viable Platform

A minimal Developer Platform proof of concept that connects a small developer-facing contract to build, delivery, runtime, routing, and observability on AWS EKS.

この `main` branch は、TVP の **Core Cloud Golden Path** を扱います。

Developer が直接 Kubernetes / EKS / ECR / GitOps の詳細を毎回操作するのではなく、

**code + `platform.yaml` + git push**

を入口として、Platform 側が共通の配布経路を引き受けることを目的としています。

> This repository is a technical PoC, not a production-ready platform.

---

## Goal

TVP の中心的な問いは単純です。

> How thin can the developer-facing interface be while still providing a reproducible build, deployment, runtime, routing, and observability path?

この branch では、以下の Golden Path を構築しました。

~~~mermaid
flowchart LR
    Dev["Developer<br/>code + platform.yaml"]
    GH["GitHub"]
    CI["GitHub Actions<br/>Build / Smoke / Render"]
    ECR["Amazon ECR<br/>Immutable SHA Image"]
    Git["Git Desired State<br/>Generated Manifest"]
    Argo["Argo CD"]
    EKS["Amazon EKS"]
    Istio["Istio Gateway"]
    Svc["Kubernetes Service"]
    Pods["Application Pods"]
    OTel["OpenTelemetry"]

    Dev --> GH
    GH --> CI
    CI --> ECR
    CI --> Git
    Git --> Argo
    Argo --> EKS
    ECR --> EKS

    Istio --> Svc --> Pods
    Pods --> OTel
~~~

The deployment control path and the HTTP request path are intentionally separated.

- Git / Argo CD controls **desired state**
- Kubernetes maintains **runtime state**
- Istio provides the minimal HTTP routing entry point
- OpenTelemetry provides the observability hook

---

## Platform Contract

The developer-facing interface is intentionally small.

~~~yaml
name: job-asset-service
type: web
port: 8080
replicas: 2

build:
  strategy: dockerfile
~~~

The contract is rendered by:

    platform/render.py

into Kubernetes resources under:

    k8s/base/

The current implementation is deliberately narrow. It is not a general-purpose internal developer platform API.

---

## Golden Path

The core flow is:

    Source Change
        ↓
    git push
        ↓
    GitHub Actions
        ↓
    ARM64 Docker Image
        ↓
    Amazon ECR
        ↓
    Generated Kubernetes Manifest
        ↓
    Git Commit
        ↓
    Argo CD
        ↓
    Amazon EKS

GitHub Actions does **not** deploy directly to Kubernetes.

CI publishes the image and updates the Git desired state. Argo CD is responsible for reconciling that Git state into the cluster.

---

## Technology Stack

| Area | Technology |
|---|---|
| Cloud | AWS |
| Infrastructure as Code | Terraform |
| Container Runtime | Docker |
| Container Registry | Amazon ECR |
| Kubernetes | Amazon EKS |
| CI | GitHub Actions |
| AWS Authentication | GitHub OIDC |
| GitOps | Argo CD |
| Environment Configuration | Kustomize |
| Routing | Istio |
| Application | TypeScript / Hono |
| Observability Interface | OpenTelemetry |

The EKS worker nodes use ARM64 instances, and CI builds ARM64 container images accordingly.

---

## AWS Foundation

Terraform manages the PoC foundation including:

- VPC
- public subnets across two Availability Zones
- IAM
- EKS
- managed node group
- ECR
- GitHub Actions OIDC integration

Current PoC characteristics include:

    Region: ap-northeast-1
    VPC: 10.10.0.0/16
    EKS: tvp-eks
    Worker architecture: ARM64
    Worker instance class: t4g.small
    ECR tag mutability: IMMUTABLE

This topology is optimized for technical validation rather than production hardening.

---

## CI / CD Responsibility

GitHub Actions performs:

    Checkout
    → AWS OIDC authentication
    → ECR login
    → Docker build
    → local /health smoke check
    → ECR push
    → platform dependency setup
    → manifest render
    → GitOps commit

Images are tagged with the source Git SHA.

The CI role can publish to ECR but does not directly deploy workloads through the Kubernetes API.

---

## GitOps

Argo CD tracks:

    k8s/overlays/dev

The repository contains:

    k8s/
    ├── base/
    └── overlays/
        ├── dev/
        └── prod/

`dev` and `prod` demonstrate environment differences with Kustomize.

The `prod` overlay is a configuration example and has not been validated as a production environment.

---

## Istio

The implemented Istio scope is intentionally small:

    HTTP
      ↓
    Istio Gateway
      ↓
    VirtualService
      ↓
    job-asset-service
      ↓
    Pods

Example local access:

    kubectl port-forward -n istio-system \
      svc/istio-ingressgateway 18080:80

    curl -i http://localhost:18080/health

The following are outside the validated scope of this branch:

- full service mesh adoption
- mTLS policy design
- retries
- circuit breaking
- rate limiting
- canary delivery
- public HTTPS ingress

---

## Repository Structure

    .
    ├── .github/workflows/
    ├── argocd/
    ├── infra/
    ├── job-asset-service/
    ├── k8s/
    │   ├── base/
    │   └── overlays/
    └── platform/

Key responsibilities:

| Path | Responsibility |
|---|---|
| `infra/` | AWS / EKS / ECR / IAM foundation |
| `job-asset-service/` | Reference application and Platform Contract |
| `platform/` | Contract-to-manifest rendering |
| `k8s/base/` | Generated/common workload definition |
| `k8s/overlays/` | Environment-specific configuration |
| `argocd/` | GitOps application definition |
| `.github/workflows/` | CI and GitOps update flow |

---

## Local Validation

Create the renderer environment:

    python3 -m venv .venv-platform
    source .venv-platform/bin/activate
    pip install -r platform/requirements.txt

Render without modifying the tracked base manifest:

    IMAGE_URI=example.invalid/tvp/job-asset-service:dev \
    RENDER_OUTPUT_PATH=/tmp/job-asset-service.yaml \
    python platform/render.py

Inspect the dev overlay:

    kubectl kustomize k8s/overlays/dev

Inspect Terraform before applying:

    terraform -chdir=infra init
    terraform -chdir=infra plan

AWS credentials and an existing compatible environment are required for actual infrastructure changes.

---

## Branches

### `main`

Core cloud Golden Path:

    Platform Contract
    → CI
    → ECR
    → GitOps
    → Argo CD
    → EKS
    → Istio
    → Observability hook

### `product-poc`

Extended architecture and reliability experiments:

- Mock Hire
- Mock Career
- Shared Job Domain
- PostgreSQL ownership boundaries
- OpenTelemetry distributed tracing
- Jaeger
- SLI / SLO validation
- k6
- Kubernetes self-healing experiment
- Argo CD self-healing experiment
- Platform guardrails
- ADRs
- Operational Runbook

See the `product-poc` branch README for details.

---

## Design Principles

The implementation follows several principles:

**Thin developer interface**

Developers should express intent without reproducing infrastructure knowledge in every service.

**Git as desired-state source**

CI produces artifacts and desired state. It does not directly mutate the application runtime.

**Immutable application images**

Source SHA tags and immutable ECR tags improve traceability.

**Infrastructure and application delivery are different lifecycles**

Terraform manages the foundation. Argo CD manages application desired state.

**Small before generic**

This project intentionally proves one narrow path before attempting a universal platform abstraction.

---

## Current Limitations

This project does not claim production readiness.

Not validated in the current scope:

- node failure
- Availability Zone failure
- managed database failure or recovery
- multi-region availability
- production-scale traffic
- long-term SLO compliance
- public production ingress
- production secrets management
- complete Kubernetes security policy
- automated rollback
- progressive delivery
- multi-team Platform adoption

The purpose of this branch is to prove the architecture and control flow with the smallest useful implementation.

---

## Status

Core TVP Golden Path: **implemented and previously validated**

Product/domain experiments and advanced reliability evidence are maintained separately in:

    product-poc

The project is evolving toward a second version of the Platform Contract while preserving this branch as the minimal cloud foundation.
