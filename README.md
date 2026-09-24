# TVP — Product PoC & Reliability Evidence

TVP (**Thinnest Viable Platform**) is a Developer Platform proof of concept that connects a thin developer-facing contract to delivery, runtime, observability, and reliability mechanisms.

This `product-poc` branch extends the core cloud Golden Path with:

- a small multi-service Product PoC
- explicit domain and database ownership
- distributed tracing with OpenTelemetry and Jaeger
- SLI / SLO validation with k6
- Kubernetes self-healing experiments
- Argo CD desired-state reconciliation experiments
- Platform Contract guardrails
- architecture decision records
- an operational runbook

> This repository is a technical PoC, not a production-ready platform.
>
> Technical-report baseline: `9fab35a`
>
> B20 end-to-end demo has not been completed yet.

---

## Why This Exists

The project explores a simple question:

> How much infrastructure complexity can a Platform absorb while keeping ownership, deployment state, failures, and recovery understandable to application developers?

The developer-facing entry point remains intentionally small:

**code + `platform.yaml` + git push**

The Platform side takes responsibility for common delivery and runtime concerns.

---

## Two Validation Scopes

This branch contains two related but distinct technical experiments.

### 1. Cloud Golden Path

The original TVP path validates:

~~~text
Developer
    ↓
GitHub Actions
    ↓
Amazon ECR
    ↓
Git desired state
    ↓
Argo CD
    ↓
Amazon EKS
    ↓
Istio
    ↓
Application
~~~

### 2. Local Product PoC

The Product PoC validates application boundaries, shared-domain ownership, PostgreSQL permissions, and distributed tracing.

~~~text
Mock Hire ─────┐
               ├──→ Job Asset Service ──→ job.jobs
Mock Career ───┘

Mock Hire   ──→ hire.job_metadata
Mock Career ──→ career.saved_jobs
~~~

The DB-backed Product PoC is **not currently the same deployed application revision as the thin Job service previously validated on EKS**.

---

## Architecture

~~~mermaid
flowchart TB

    subgraph Cloud["Cloud Golden Path"]
        Dev["Developer<br/>code + platform.yaml"]
        CI["GitHub Actions"]
        ECR["Amazon ECR"]
        Git["Git Desired State"]
        Argo["Argo CD"]
        EKS["Amazon EKS"]
        Istio["Istio Gateway"]
        CloudJob["Job Service"]

        Dev --> CI
        CI --> ECR
        CI --> Git
        Git --> Argo
        Argo --> EKS
        ECR --> EKS
        Istio --> CloudJob
    end

    subgraph Product["Local Product PoC"]
        Hire["Mock Hire<br/>:8081"]
        Career["Mock Career<br/>:8082"]
        Job["Job Asset Service<br/>:8080"]
        PG["PostgreSQL<br/>host :5433"]

        Hire --> Job
        Career --> Job

        Job --> PG
        Hire --> PG
        Career --> PG
    end

    subgraph Observability["Observability"]
        OTel["OpenTelemetry Collector"]
        Jaeger["Jaeger"]
    end

    Hire --> OTel
    Career --> OTel
    Job --> OTel
    OTel --> Jaeger
~~~

---

## Product PoC

The PoC contains three services.

### Job Asset Service

Owns canonical Job data.

~~~text
GET  /health
GET  /jobs
POST /jobs
GET  /jobs/:id
~~~

Responsibilities:

- validate Job input
- create Job identifiers
- store canonical Job data
- expose Job data through an API

### Mock Hire

Represents a hiring-company-side workflow.

~~~text
GET  /health
POST /hire/jobs
~~~

A Job is created through the Job Asset Service.

Hire-specific metadata is stored separately in:

~~~text
hire.job_metadata
~~~

### Mock Career

Represents a candidate-facing workflow.

~~~text
GET  /health
GET  /career/jobs
POST /career/saved-jobs
~~~

Career obtains canonical Job data through the Job API.

Career-specific state is stored in:

~~~text
career.saved_jobs
~~~

---

## Domain Ownership

The central design rule is:

> Shared domain data is owned by one service and consumed through its API instead of being treated as a shared SQL table.

Canonical Job data belongs to:

~~~text
Job Asset Service
~~~

Product-specific data remains with the product context.

| Domain | Schema / Table | DB Role |
|---|---|---|
| Job | `job.jobs` | `job_service` |
| Hire | `hire.job_metadata` | `hire_service` |
| Career | `career.saved_jobs` | `career_service` |

PostgreSQL is physically one instance in this PoC, but ownership is separated through schemas and roles.

---

## Database Boundary Validation

The following cross-domain access patterns were tested and rejected by PostgreSQL permissions:

~~~text
hire_service   → job.jobs
career_service → job.jobs
job_service    → hire.job_metadata
~~~

The tested calls returned permission errors.

This demonstrates that the application-level ownership rule is also enforced at the tested database-role boundary.

It does **not** prove:

- complete tenant isolation
- physical DB isolation
- every role/action combination
- protection against database administrators

---

## Local PostgreSQL Bootstrap

The database is reproducible from repository files.

Copy the environment template:

~~~bash
cp .env.product-poc.example .env.product-poc
~~~

Set local development credentials, then start PostgreSQL:

~~~bash
docker compose \
  --env-file .env.product-poc \
  -f docker-compose.product-poc.yml \
  up -d
~~~

The PoC uses:

~~~text
postgres:17-alpine
host 5433 → container 5432
~~~

Initialization files:

~~~text
database/init/001-schema.sql
database/init/002-roles.sh
~~~

The Compose definition starts PostgreSQL only.

The three application services are run as separate processes.

`docker compose down -v` destroys the named volume and must not be treated as a recovery procedure.

---

## Platform Contract

Current developer-facing contract:

~~~yaml
name: job-asset-service
type: web
port: 8080
replicas: 2

build:
  strategy: dockerfile
~~~

The renderer:

~~~text
platform/render.py
~~~

converts the contract into Kubernetes Deployment and Service resources.

This is intentionally a thin, single-service abstraction rather than a general-purpose Platform API.

---

## Guardrails

The Platform Contract validates input before generating Kubernetes resources.

Implemented constraints include:

- required keys
- DNS-1123-compatible service names
- service name length
- `type: web`
- `build.strategy: dockerfile`
- valid TCP port range
- replicas between 1 and 10
- image must be provided
- `:latest` is rejected

Generated workloads include default resources and health probes:

~~~text
requests:
  CPU:    50m
  memory: 64Mi

limits:
  CPU:    500m
  memory: 256Mi
~~~

Health checks use:

~~~text
/health
~~~

for readiness and liveness.

The existing local guardrail suite contains 9 test cases.

Run:

~~~bash
source .venv-platform/bin/activate
python platform/test_guardrails.py
~~~

These guardrails do not replace Kubernetes admission policy, RBAC, NetworkPolicy, Pod Security, image signing, or vulnerability policy.

---

## CI

The core CI path uses GitHub Actions.

~~~text
Checkout
   ↓
AWS OIDC
   ↓
ECR Login
   ↓
Docker Build
   ↓
/health Smoke Test
   ↓
ECR Push
   ↓
Guardrail Test
   ↓
Manifest Render
   ↓
GitOps Commit
~~~

Images use the Git source SHA as the tag.

The ECR repository is configured with immutable tags.

The GitHub Actions role publishes images to ECR but does not directly deploy workloads into Kubernetes.

---

## GitOps

Application desired state is stored in Git.

~~~text
k8s/
├── base/
└── overlays/
    ├── dev/
    └── prod/
~~~

Argo CD reconciles the Git state into EKS.

Kustomize manages environment differences.

These responsibilities are intentionally separate:

~~~text
Kustomize
    = construct manifests

Argo CD
    = compare Git desired state with live state

Kubernetes
    = maintain runtime state
~~~

---

## Istio

The validated Istio scope is deliberately small.

~~~text
HTTP Client
    ↓
Istio Gateway
    ↓
VirtualService
    ↓
Kubernetes Service
    ↓
Job Pods
~~~

Example local tunnel:

~~~bash
kubectl port-forward -n istio-system \
  svc/istio-ingressgateway 18080:80
~~~

Then:

~~~bash
curl -i http://localhost:18080/health
~~~

Not validated in this PoC:

- mTLS policy
- retry policy
- circuit breaking
- rate limiting
- canary delivery
- public HTTPS ingress

---

## OpenTelemetry

The application services initialize OpenTelemetry before application startup.

Observed instrumentation includes:

- inbound HTTP
- outbound HTTP
- PostgreSQL operations

Each service has a distinct:

~~~text
service.name
~~~

Trace transport:

~~~text
Application
    ↓
OTLP
    ↓
OpenTelemetry Collector
    ↓
Jaeger
~~~

Collector ports:

~~~text
OTLP HTTP  4318
OTLP gRPC  4317
~~~

Jaeger UI:

~~~text
16686
~~~

Useful local tunnels:

~~~bash
kubectl port-forward svc/otel-collector 4318:4318
~~~

~~~bash
kubectl port-forward svc/jaeger 16686:16686
~~~

---

## Distributed Trace Validation

A cross-service trace was observed across the Product PoC.

Example path:

~~~text
career-api
    ↓
job-asset-service
    ↓
PostgreSQL
~~~

The same Trace ID could be followed through service boundaries and database spans.

During implementation, manual `traceparent` propagation was initially combined with automatic HTTP instrumentation.

That produced duplicate propagation and split traces.

The manual injection was removed so automatic instrumentation could propagate the context once.

This debugging result is part of the technical evidence of the PoC.

---

## Observability Scope

The implemented observability proof is primarily **distributed tracing**.

Implemented:

- OpenTelemetry application instrumentation
- OTel Collector
- Jaeger
- service-to-service tracing
- DB spans

Not implemented as a persistent operational platform:

- Prometheus-based continuous metric collection
- centralized log search
- SLO dashboards
- automated alerting
- on-call notification
- error-budget-based release control

k6 results are test evidence and should not be described as continuous SLO monitoring.

---

## SLI / SLO

Two user journeys were selected.

### Browse Jobs

~~~text
GET /career/jobs
~~~

Validation target:

~~~text
Availability > 99%
p95 latency < 500 ms
~~~

### Publish Job

~~~text
POST /hire/jobs
~~~

Validation target:

~~~text
Availability > 99%
p95 latency < 1000 ms
~~~

These are **TVP validation targets**, not production SLOs.

---

## k6 Results

Each scenario ran for three minutes.

### Browse

~~~text
Rate:       10 requests/s
Requests:   1,801
Failures:   0
p95:        9.011 ms
Max:        17.211 ms
~~~

### Publish

~~~text
Rate:       1 request/s
Requests:   181
Failures:   0
p95:        11.549 ms
Max:        20.045 ms
~~~

Combined:

~~~text
1,982 requests
0 observed HTTP failures
~~~

The tests were executed against the **local Product PoC**.

They were not measurements of public Internet traffic or the EKS production-like path.

They do not establish long-term SLO compliance or production capacity.

---

## Reliability Experiment A — Kubernetes Self-Healing

The first controlled experiment tested Kubernetes runtime reconciliation.

Initial state:

~~~text
Job Deployment
replicas = 2
~~~

Traffic:

~~~text
5 RPS for 3 minutes
~~~

One Pod was manually deleted while traffic was running.

Observed timeline:

~~~text
02:03:50  Pod deleted
02:03:50  replacement Pod started
02:03:54  replacement Pod Ready
~~~

Observed recovery:

~~~text
approximately 4 seconds
~~~

Traffic result:

~~~text
900 requests
900 HTTP 200
0 failures
p95 81.316 ms
~~~

The controller responsible for recovery was Kubernetes Deployment / ReplicaSet reconciliation.

This was a **Pod failure experiment**, not a Node or Availability Zone failure experiment.

---

## Reliability Experiment B — Argo CD Self-Healing

The second experiment tested desired-state reconciliation.

Git remained:

~~~text
replicas = 2
~~~

The live Deployment was manually changed to:

~~~text
replicas = 1
~~~

Observed state transitions:

~~~text
Synced / Healthy
        ↓
OutOfSync / Healthy
        ↓
Synced / Progressing
        ↓
Synced / Healthy
~~~

Final runtime state:

~~~text
2 / 2 Ready
~~~

Traffic result:

~~~text
901 requests
901 HTTP 200
0 failures
p95 103.926 ms
~~~

The responsibilities are different:

~~~text
Kubernetes
    maintains the current Deployment specification

Argo CD
    restores the Deployment specification to the Git desired state
~~~

---

## Reliability Evidence

The repository contains test scripts and saved summaries under:

~~~text
load-tests/
~~~

The controlled experiment write-up is:

~~~text
docs/b16-reliability-experiment.md
~~~

The document records:

- hypothesis
- injected failure
- observed behavior
- recovery mechanism
- test results
- limitations

It is a **controlled reliability experiment**, not a production incident postmortem.

---

## Architecture Decision Records

Architecture decisions are documented in:

~~~text
docs/b18-architecture-decisions.md
~~~

The ADR set records decisions around:

- Git desired state
- Platform Contract
- guardrails
- Kustomize
- limited Istio usage
- OpenTelemetry and Jaeger
- shared Job Domain ownership
- local Product PoC vs cloud Golden Path
- GitHub Actions OIDC
- immutable image tags

The purpose is to record not only what was built, but why the implementation boundary was chosen.

---

## Operational Runbook

Operational procedures are documented in:

~~~text
docs/b19-operational-runbook.md
~~~

Topics include:

- Pod failure
- Argo CD drift
- unhealthy application
- missing traces
- Collector / Jaeger diagnosis
- CI failure
- renderer / guardrail failure
- Git bot race
- Istio capacity issue
- local DB reconstruction
- rollback procedure
- incident evidence collection
- recovery exit criteria

The Runbook is an operational baseline for this PoC.

It is not a complete production on-call process.

---

## Current Rollback Status

Rollback is currently **documented but not experimentally validated as an end-to-end bad-release recovery**.

The Runbook describes returning Git desired state to a known-good revision.

However, the project has not yet injected a bad application release and measured:

~~~text
Bad Release
    ↓
Detection
    ↓
Diagnosis
    ↓
Git Rollback
    ↓
Argo Reconciliation
    ↓
User Recovery
~~~

Therefore automated or proven application rollback is not claimed.

---

## Important Branch Boundary

`product-poc` must not currently be treated as a drop-in replacement for the cloud `main` branch.

The DB-backed Job service requires:

~~~text
DATABASE_URL
~~~

The existing cloud CI smoke path and EKS workload configuration do not yet provide that database dependency.

Therefore:

> Do not blindly merge `product-poc` into the existing cloud deployment path.

The local Product PoC and the cloud Golden Path remain separate validated scopes until the integration is intentionally designed and tested.

---

## Repository Areas

~~~text
.
├── .github/workflows/
├── argocd/
├── career-api/
├── database/
├── docs/
├── hire-api/
├── infra/
├── job-asset-service/
├── k8s/
├── load-tests/
└── platform/
~~~

Responsibilities:

| Path | Responsibility |
|---|---|
| `.github/workflows/` | CI and GitOps update |
| `argocd/` | Argo CD application definition |
| `infra/` | Terraform / AWS foundation |
| `job-asset-service/` | shared Job Domain |
| `hire-api/` | hiring-side reference product |
| `career-api/` | candidate-side reference product |
| `database/` | schema and role bootstrap |
| `platform/` | Platform Contract renderer and guardrails |
| `k8s/` | Kubernetes / Kustomize / Istio / observability manifests |
| `load-tests/` | SLI and reliability experiments |
| `docs/` | experiment report, ADRs, Runbook |

---

## B01–B20 Status

| Block | Status |
|---|---|
| B01 README | completed by this README |
| B02 AWS Foundation | implemented |
| B03 EKS Runtime | implemented / previously validated |
| B04 Platform Contract | implemented |
| B05 CI | implemented |
| B06 GitOps | implemented |
| B07 Argo CD | implemented / validated |
| B08 Kustomize | implemented |
| B09 Istio | minimal implementation / validated |
| B10 Shared Domain | implemented |
| B11 Product PoC | implemented locally |
| B12 DB Ownership | implemented / tested |
| B13 Observability | distributed tracing validated |
| B14 SLI / SLO | defined and measured |
| B15 Reliability | two controlled experiments completed |
| B16 Reliability Report | documented |
| B17 Guardrails | implemented / tested |
| B18 ADR | documented |
| B19 Runbook | documented |
| B20 Demo | not completed |

---

## Known Limitations

This PoC does not claim validation of:

- production authentication / authorization
- tenant isolation
- production secrets management
- schema migration lifecycle
- PostgreSQL backup / PITR
- distributed transaction recovery
- full API test coverage
- node failure
- Availability Zone failure
- database failure
- Kubernetes control-plane failure
- multi-region operation
- public production ingress
- long-term SLO monitoring
- automated alerting
- production on-call
- automated rollback
- canary deployment
- progressive delivery
- full service-mesh policy
- production security hardening
- multi-team Platform adoption
- business productivity improvement

The scope is intentionally narrow enough that each claim can be tied to implementation or evidence.

---

## Design Principles

### Thin interface

Expose developer intent instead of exposing every infrastructure implementation detail.

### Explicit ownership

Shared data should still have an identifiable owner.

### Git desired state

Delivery state should be reviewable and reproducible.

### Separate reconciliation loops

Kubernetes runtime reconciliation and Argo CD Git reconciliation solve different problems.

### Observe user journeys

Reliability should be discussed in terms of user-visible operations, not only CPU and Pod status.

### Fail visibly

A self-service abstraction is incomplete if users cannot understand why it failed.

### Evidence before claims

Implemented, tested, documented, and untested states are intentionally distinguished.

### Small before generic

The goal is not to build the largest Platform.

The goal is to validate the smallest architecture that demonstrates the responsibility boundaries clearly.

---

## Next Direction — TVP v2

The next iteration will focus on evolving the Platform Contract toward a more realistic service interface.

Candidate contract concepts include:

~~~text
owner
runtime profile
resource class
data dependency
secret reference
observability profile
SLO reference
runbook reference
recovery policy
~~~

The intention is not to add every possible Platform feature.

The next version should extend the contract only where a concrete Platform responsibility can be implemented, validated, and explained.

---

## Project Status

Current technical baseline:

~~~text
product-poc @ 9fab35a
~~~

B01–B19 are represented by implementation, experiments, or operational documentation with the limitations described above.

B20 — the final end-to-end demo — remains the next presentation-oriented milestone.
