# B18 — Architecture Decision Records

Status: Accepted  
Scope: TVP / HERP-oriented Platform Engineering technical proof  
Branch context: `product-poc`

This document records the major architecture decisions already implemented in the TVP. It is not a reconstruction of HERP's internal architecture. It documents the design of this PoC and the reasoning behind it.

---

## ADR-001 — Git is the source of truth for application deployment state

### Context

The TVP needs a reproducible deployment model in which desired application state can be reviewed, versioned, and reconciled automatically.

The platform must separate source code, built container images, deployment desired state, and live Kubernetes runtime state.

### Decision

Use Git as the source of truth for Kubernetes desired state.

```text
Developer change
  ↓
GitHub Actions
  ↓
Build container image
  ↓
Push immutable image to ECR
  ↓
Render Kubernetes desired state
  ↓
Commit generated manifest to Git
  ↓
Argo CD
  ↓
EKS
```

Argo CD continuously reconciles Git-defined desired state with the live cluster.

### Alternatives considered

- direct `kubectl apply` from CI,
- manually managed manifests,
- CI pushing changes directly into the Kubernetes API.

### Consequences

Positive:

- deployment intent is versioned,
- drift is detectable,
- rollback can use Git history,
- deployment ownership is separated from the CI runner,
- Argo CD can automatically self-heal live drift.

Trade-offs:

- Git bot commits can race with human commits,
- Git history becomes part of deployment operation,
- reconciliation is asynchronous rather than an imperative one-shot deployment.

### Status

Accepted.

---

## ADR-002 — Use a thin Platform Contract instead of exposing raw Kubernetes

### Context

Application developers should not need to understand every Kubernetes field to deploy a standard service. The platform should expose a smaller interface representing application intent.

### Decision

Use `platform.yaml` as the developer-facing contract.

Current contract:

```yaml
name: job-asset-service
type: web
port: 8080
replicas: 2

build:
  strategy: dockerfile
```

`platform/render.py` converts this contract into Kubernetes manifests.

### Alternatives considered

- requiring developers to write Kubernetes YAML directly,
- Helm charts exposed directly to every developer,
- Backstage scaffolding,
- Crossplane or a broader platform API.

### Consequences

Positive:

- lower developer-facing infrastructure complexity,
- one controlled interface for deployment policy,
- easier enforcement of safe defaults,
- implementation details can evolve behind the contract.

Trade-offs:

- the contract supports fewer use cases than raw Kubernetes,
- the renderer becomes platform-owned code,
- new workload types require explicit platform support.

### Status

Accepted.

---

## ADR-003 — Enforce guardrails at the Platform Contract boundary

### Context

A self-service platform must provide freedom without allowing obviously unsafe declarations to reach Kubernetes.

### Decision

Validate the contract in `platform/render.py` before manifest generation.

Current hard guardrails:

- `replicas` must be between 1 and 10,
- `port` must be between 1 and 65535,
- service name must be a valid Kubernetes DNS-1123 label,
- workload type must be `web`,
- build strategy must be `dockerfile`,
- mutable `:latest` image tags are rejected.

The platform also injects safe defaults:

- CPU request: `50m`,
- memory request: `64Mi`,
- CPU limit: `500m`,
- memory limit: `256Mi`,
- readiness probe on `/health`,
- liveness probe on `/health`.

Guardrail tests run before rendering in CI.

### Alternatives considered

- documentation-only rules,
- allowing Kubernetes admission failure to reject invalid values,
- introducing OPA/Gatekeeper for the TVP.

### Consequences

Positive:

- unsafe declarations fail early,
- policy is executable and testable,
- developers do not need to repeat baseline runtime settings,
- capacity/cost mistakes can be rejected before reaching the cluster.

Trade-offs:

- values such as `replicas <= 10` are TVP policy rather than universal production defaults,
- some Kubernetes flexibility is intentionally hidden.

### Status

Accepted.

---

## ADR-004 — Use Kustomize for environment-specific desired state

### Context

The platform needs a common deployment base while allowing environment-specific differences. The TVP does not need a large templating system.

### Decision

Use Kustomize with a shared base and environment overlays.

```text
k8s/
├── base/
│   ├── job-asset-service.yaml
│   └── kustomization.yaml
└── overlays/
    ├── dev/
    └── prod/
```

### Alternatives considered

- duplicate YAML per environment,
- Helm,
- runtime substitution from CI.

### Consequences

Positive:

- Git remains readable,
- environment deltas are explicit,
- generated application state remains separate from environment customization.

Trade-offs:

- overlay growth must be controlled,
- complex templating is intentionally avoided.

### Status

Accepted.

---

## ADR-005 — Limit Istio to routing needs in the current TVP

### Context

Istio can provide routing, traffic management, security, telemetry, retries, circuit breaking, and other service-mesh capabilities. The TVP does not need to demonstrate the entire feature set.

### Decision

Use Istio only where it adds direct value to the current proof:

- ingress routing,
- Gateway,
- VirtualService.

Do not expand the TVP into full service-mesh mastery.

### Alternatives considered

- standard Kubernetes Ingress only,
- full Istio sidecar injection and advanced traffic policy,
- no ingress abstraction.

### Consequences

Positive:

- demonstrates service-mesh integration without expanding scope,
- keeps the proof focused on platform behavior.

Trade-offs:

- circuit breaking, mTLS policy, retries, and advanced traffic shaping are not currently demonstrated.

### Status

Accepted.

---

## ADR-006 — Standardize tracing on OpenTelemetry with a Collector and Jaeger

### Context

The Product PoC contains multiple service boundaries:

```text
Career
  ↓
Shared Job Domain

Hire
  ↓
Shared Job Domain
```

A request must be traceable across HTTP calls and PostgreSQL operations.

### Decision

Instrument services using OpenTelemetry.

```text
Application
  ↓ OTLP
OpenTelemetry Collector
  ├─ debug exporter
  └─ OTLP
       ↓
     Jaeger
```

The Collector provides a common telemetry ingestion boundary. Jaeger is used as the trace backend/UI for the TVP.

### Alternatives considered

- application logs only,
- direct application export to Jaeger,
- Grafana + Tempo,
- Datadog.

### Consequences

Positive:

- vendor-neutral instrumentation,
- trace propagation across service boundaries,
- request-to-database visibility,
- backend can be changed without rewriting application instrumentation.

Trade-offs:

- Jaeger storage is PoC-grade and ephemeral,
- metrics/log aggregation are not part of this tracing decision,
- production observability would require retention, alerting, and operational ownership.

### Status

Accepted.

---

## ADR-007 — Shared Job Domain owns canonical Job data

### Context

The Product PoC models multiple product surfaces using the same canonical job concept. Allowing every service to read and write the same database tables would erase domain ownership.

### Decision

`job-asset-service` owns canonical Job data.

Consumers such as Hire and Career access Job data through the Job Domain API.

Logical database ownership is enforced using PostgreSQL schemas and roles.

```text
job_service
  → job.jobs

hire_service
  → hire.job_metadata

career_service
  → career.saved_jobs
```

Hire and Career do not receive direct permission to read `job.jobs`.

### Alternatives considered

- one shared database user,
- direct cross-schema reads,
- separate PostgreSQL servers for every PoC service.

### Consequences

Positive:

- service ownership is explicit,
- API boundaries and database boundaries reinforce each other,
- unauthorized cross-domain reads fail at the database permission layer.

Trade-offs:

- all schemas currently live in one PostgreSQL instance for PoC simplicity,
- physical database isolation is not demonstrated,
- cross-service transactions require careful design in production.

### Status

Accepted.

---

## ADR-008 — Keep the Product PoC local while proving the Golden Path in EKS

### Context

The Product PoC now contains Mock Hire, Mock Career, Shared Job Domain, PostgreSQL schema ownership, distributed tracing, Jaeger, and database bootstrap logic.

Deploying all of this to EKS would require additional platform work that is not required to prove the current Golden Path.

### Decision

Keep the multi-service Product PoC locally reproducible.

Use the thinner `job-asset-service` deployment to prove the cloud Golden Path and platform control loops in EKS.

### Alternatives considered

- deploy the complete Product PoC to EKS immediately,
- expand the Platform Contract to support every new component before completing the TVP.

### Consequences

Positive:

- prevents scope expansion,
- separates product/domain modeling from cloud platform proof,
- preserves a fast local environment for application experimentation,
- keeps EKS focused on deployment/reconciliation evidence.

Trade-offs:

- the full multi-service Product PoC is not currently cloud-hosted,
- local SLI/SLO results cannot be presented as EKS production-performance results.

### Status

Accepted.

---

## ADR-009 — Use GitHub Actions with AWS OIDC and immutable ECR image tags

### Context

CI requires AWS access to push images to ECR. Long-lived AWS access keys in GitHub would create avoidable credential risk. Mutable tags would weaken reproducibility.

### Decision

Use GitHub Actions OIDC to assume the CI AWS role.

Build ARM64 container images and tag them using the Git commit SHA.

ECR uses immutable tags.

### Alternatives considered

- long-lived AWS access keys stored as GitHub Secrets,
- mutable `latest` tags,
- manual image publishing.

### Consequences

Positive:

- no long-lived AWS credential is required by CI,
- image identity is tied to source history,
- deployment state is reproducible,
- accidental tag mutation is prevented.

Trade-offs:

- IAM/OIDC configuration is more complex than static keys,
- SHA-based image tags are less human-readable.

### Status

Accepted.

---

# Decision Summary

The TVP deliberately prefers a thin, bounded platform:

```text
Developer intent
  ↓
platform.yaml
  ↓
validated Platform Contract
  ↓
GitHub Actions
  ↓
immutable image
  ↓
Git desired state
  ↓
Argo CD
  ↓
EKS
```

The platform hides unnecessary infrastructure detail while preserving explicit service ownership, observable runtime behavior, reproducible deployment state, and clear reconciliation boundaries.

The current design is intentionally not a production-complete internal developer platform. It is the thinnest implementation necessary to prove the operating model.
