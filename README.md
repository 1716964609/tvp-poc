# TVP — Thinnest Viable Platform

アプリケーション開発者が扱うインターフェースを小さく保ちながら、Build / Deploy / Run / Observe の共通部分をPlatform側へ集約するためのDeveloper Platform PoCです。

この `product-poc` branchでは、Core TVPに加えて、Domain Ownership、Distributed Tracing、SLI / SLO、Reliability、Guardrail、ADR、Runbookまで検証範囲を拡張しています。

> 本リポジトリは技術検証用PoCです。商用運用済みPlatformを示すものではありません。
>
> 技術状態の固定基準: `9fab35a`
>
> B20のend-to-end Demoは未実施です。

---

## 1. このbranchで確認したこと

`product-poc` では、以下を実装・検証しました。

- Mock Hire / Mock Career / Job Asset Serviceの3サービス構成
- Job Domainを共有能力として切り出す設計
- PostgreSQLのschema / roleによるData Ownership
- OpenTelemetry + JaegerによるDistributed Tracing
- k6によるSLI / SLO測定
- KubernetesによるPod self-healing
- Argo CDによるdesired state self-healing
- Platform ContractのGuardrail
- Architecture Decision Record
- Operational Runbook

一方で、以下はまだ実証していません。

- Node障害
- AZ障害
- DB障害
- Production Authentication / Authorization
- 長期SLO運用
- Alert / On-call
- Automated Rollback
- Canary / Progressive Delivery
- Product PoC全体のEKS配備
- 複数チームでのPlatform adoption

実装済み・検証済み・文書化済み・未検証を区別して記録しています。

---

## 2. TVPの目的

TVPが検証する中心的な問いは次です。

> DeveloperがInfrastructureの詳細を毎回理解・操作しなくても、安全にBuild / Deploy / Run / Observeできる最小のPlatform interfaceはどこまで薄くできるか。

Developer側の入口は、意図的に小さくしています。

~~~text
code
+
platform.yaml
+
git push
~~~

Platform側が、その後の共通処理を引き受けます。

~~~text
Developer
    ↓
GitHub Actions
    ↓
Amazon ECR
    ↓
Git Desired State
    ↓
Argo CD
    ↓
Amazon EKS
~~~

---

## 3. 二つの検証範囲

このbranchには、関連しているが同一ではない二つの検証があります。

### Cloud Golden Path

Core TVPでは以下を検証しました。

~~~text
Developer
    ↓
GitHub Actions
    ↓
Amazon ECR
    ↓
Git Desired State
    ↓
Argo CD
    ↓
Amazon EKS
    ↓
Istio
    ↓
Job Service
~~~

### Local Product PoC

Product PoCでは、業務境界・Data Ownership・Distributed Traceを検証しました。

~~~text
Mock Hire ─────┐
               ├──→ Job Asset Service ──→ job.jobs
Mock Career ───┘

Mock Hire   ──→ hire.job_metadata
Mock Career ──→ career.saved_jobs
~~~

重要なのは、Cloud側で検証した薄いJob Serviceと、Local Product PoCのDB付きJob Serviceは、現在同一のdeploy済みrevisionではないことです。

---

## 4. Architecture

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

    subgraph Observe["Observability"]
        OTel["OpenTelemetry Collector"]
        Jaeger["Jaeger"]
    end

    Hire --> OTel
    Career --> OTel
    Job --> OTel
    OTel --> Jaeger
~~~

---

## 5. Product PoC

### Job Asset Service

求人という共有Domainの正本を所有します。

~~~text
GET  /health
GET  /jobs
POST /jobs
GET  /jobs/:id
~~~

主な責任:

- Job入力のvalidation
- UUID生成
- canonical Job dataの保存
- Job APIの提供

### Mock Hire

採用企業側の文脈を表す参照サービスです。

~~~text
GET  /health
POST /hire/jobs
~~~

Job作成自体はJob Asset ServiceのAPI経由で行い、Hire固有の情報だけを次へ保存します。

~~~text
hire.job_metadata
~~~

### Mock Career

求職者側の文脈を表す参照サービスです。

~~~text
GET  /health
GET  /career/jobs
POST /career/saved-jobs
~~~

Job情報はJob API経由で取得し、Career固有の状態だけを次へ保存します。

~~~text
career.saved_jobs
~~~

---

## 6. Data Ownership

中心的な設計原則は次です。

> 論理的に共有されるDomain dataであっても、全サービスが同じSQL tableを自由に読み書きする設計にはしない。

PostgreSQLは物理的には1インスタンスですが、schemaとroleで所有権を分離しています。

| Domain | Schema / Table | DB Role |
|---|---|---|
| Job | `job.jobs` | `job_service` |
| Hire | `hire.job_metadata` | `hire_service` |
| Career | `career.saved_jobs` | `career_service` |

確認した越境アクセス:

~~~text
hire_service   → job.jobs
career_service → job.jobs
job_service    → hire.job_metadata
~~~

これらはPostgreSQL側でpermission deniedになりました。

これは確認したrole / operationにおいてData OwnershipがDB権限でも強制されている証拠です。

ただし、以下を意味しません。

- 全role / 全operationの網羅
- tenant isolation
- 物理DB分離
- DBA権限からの完全隔離

---

## 7. Local PostgreSQL

環境変数ファイルを作成します。

~~~bash
cp .env.product-poc.example .env.product-poc
~~~

必要なlocal credentialを設定した後、PostgreSQLを起動します。

~~~bash
docker compose \
  --env-file .env.product-poc \
  -f docker-compose.product-poc.yml \
  up -d
~~~

構成:

~~~text
postgres:17-alpine

host 5433
    ↓
container 5432
~~~

初期化:

~~~text
database/init/001-schema.sql
database/init/002-roles.sh
~~~

ComposeはPostgreSQLだけを起動します。

3つのApplication Serviceは別processとして起動します。

`docker compose down -v` はnamed volumeを削除するため、Recovery手順としては扱いません。

---

## 8. Platform Contract

現在のdeveloper-facing contractは次です。

~~~yaml
name: job-asset-service
type: web
port: 8080
replicas: 2

build:
  strategy: dockerfile
~~~

renderer:

~~~text
platform/render.py
~~~

がContractを読み取り、Kubernetes Deployment / Serviceへ変換します。

現時点では単一service向けの薄いinterfaceであり、汎用Platform APIではありません。

---

## 9. Guardrail

Platform Contractはmanifest生成前に入力を検証します。

主な制約:

- required key
- DNS-1123互換service name
- service name長
- `type: web`
- `build.strategy: dockerfile`
- port範囲
- replicas 1〜10
- image必須
- `:latest`拒否

標準runtime設定:

~~~text
requests:
  CPU:    50m
  memory: 64Mi

limits:
  CPU:    500m
  memory: 256Mi
~~~

Health Check:

~~~text
readiness: /health
liveness:  /health
~~~

既存test suiteは9ケースです。

~~~bash
source .venv-platform/bin/activate
python platform/test_guardrails.py
~~~

これはAdmission Policy、RBAC、NetworkPolicy、Pod Security、Image Signing等の代替ではありません。

---

## 10. CI

GitHub Actionsの基本経路:

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

Container Imageにはsource Git SHAをtagとして使用します。

ECRはimmutable tag設定です。

CI roleはECRへimageをpublishしますが、Kubernetesへ直接deployしません。

---

## 11. GitOps

Application Desired StateはGitで管理します。

~~~text
k8s/
├── base/
└── overlays/
    ├── dev/
    └── prod/
~~~

責任を分離しています。

~~~text
Kustomize
    ↓
Manifestを組み立てる

Argo CD
    ↓
GitとLive Stateの差を検知・修復する

Kubernetes
    ↓
Live Runtime Stateを維持する
~~~

`prod` overlayが存在することはProduction品質の成立を意味しません。

---

## 12. Istio

Istioの検証範囲は最小限です。

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

Local access:

~~~bash
kubectl port-forward -n istio-system \
  svc/istio-ingressgateway 18080:80
~~~

~~~bash
curl -i http://localhost:18080/health
~~~

未検証:

- mTLS policy
- retry
- circuit breaker
- rate limit
- canary
- public HTTPS ingress

---

## 13. OpenTelemetry / Jaeger

Application ServiceはOpenTelemetryでinstrumentationしています。

確認対象:

- inbound HTTP
- outbound HTTP
- PostgreSQL operation

Trace path:

~~~text
Application
    ↓
OTLP
    ↓
OpenTelemetry Collector
    ↓
Jaeger
~~~

Collector:

~~~text
OTLP HTTP  4318
OTLP gRPC  4317
~~~

Jaeger UI:

~~~text
16686
~~~

Tunnel例:

~~~bash
kubectl port-forward svc/otel-collector 4318:4318
~~~

~~~bash
kubectl port-forward svc/jaeger 16686:16686
~~~

---

## 14. Distributed Trace

以下のservice境界をまたぐtraceを確認しました。

~~~text
career-api
    ↓
job-asset-service
    ↓
PostgreSQL
~~~

同一Trace IDからHTTP spanとDB spanを追跡できます。

実装途中では、manualな`traceparent` injectionとHTTP auto instrumentationを同時使用したため、headerが二重伝播しtraceが分割される問題が発生しました。

manual injectionを削除し、auto instrumentationに伝播を一本化することで修正しました。

---

## 15. Observabilityの範囲

現在のObservability PoCはDistributed Tracingが中心です。

実装済み:

- OpenTelemetry SDK
- OTel Collector
- Jaeger
- Service-to-Service Trace
- DB Span

常設運用基盤として未実装:

- Prometheus等による継続Metrics
- Centralized Log Search
- SLO Dashboard
- Alert
- On-call Notification
- Error Budget based Release Control

k6結果は実験データであり、常時SLO Monitoringではありません。

---

## 16. SLI / SLO

User Journeyを起点に二つのSLI / SLOを設定しました。

### Browse Jobs

~~~text
GET /career/jobs

Availability > 99%
p95 latency < 500 ms
~~~

### Publish Job

~~~text
POST /hire/jobs

Availability > 99%
p95 latency < 1000 ms
~~~

これはTVP検証用の目標値であり、商用Production SLOではありません。

---

## 17. k6結果

各scenarioを3分間実行しました。

### Browse Jobs

~~~text
Rate:       10 requests/s
Requests:   1,801
Failures:   0
p95:        9.011 ms
Max:        17.211 ms
~~~

### Publish Job

~~~text
Rate:       1 request/s
Requests:   181
Failures:   0
p95:        11.549 ms
Max:        20.045 ms
~~~

合計:

~~~text
1,982 requests
0 observed HTTP failures
~~~

測定対象はLocal Product PoCです。

EKS経由のProduction-like performanceではありません。

また、短時間のSynthetic Testであり、長期SLO達成やProduction Capacityを示すものではありません。

---

## 18. Reliability Experiment A — Kubernetes Self-Healing

条件:

~~~text
replicas = 2
5 RPS
3 minutes
~~~

Traffic中にPodを1つ削除しました。

Timeline:

~~~text
02:03:50  Pod deleted
02:03:50  replacement Pod started
02:03:54  replacement Pod Ready
~~~

Observed recovery:

~~~text
約4秒
~~~

Traffic result:

~~~text
900 requests
900 HTTP 200
0 failures
p95 81.316 ms
~~~

この復旧主体はKubernetes Deployment / ReplicaSetです。

Argo CDではありません。

また、これはPod Failureの検証であり、Node FailureやAZ Failureではありません。

---

## 19. Reliability Experiment B — Argo CD Self-Healing

Git Desired State:

~~~text
replicas = 2
~~~

のまま、Live Deploymentだけを手動で次へ変更しました。

~~~text
replicas = 1
~~~

Observed state:

~~~text
Synced / Healthy
        ↓
OutOfSync / Healthy
        ↓
Synced / Progressing
        ↓
Synced / Healthy
~~~

Final state:

~~~text
2 / 2 Ready
~~~

Traffic:

~~~text
901 requests
901 HTTP 200
0 failures
p95 103.926 ms
~~~

この実験で確認した役割分担:

~~~text
Kubernetes
    ↓
現在のDeployment specを維持する

Argo CD
    ↓
Live specをGit Desired Stateへ戻す
~~~

---

## 20. Reliability Evidence

Load Test:

~~~text
load-tests/
~~~

Reliability Experiment Report:

~~~text
docs/b16-reliability-experiment.md
~~~

B16はProduction IncidentのPostmortemではなく、Controlled Reliability Experimentの記録です。

---

## 21. ADR

Architecture Decision Record:

~~~text
docs/b18-architecture-decisions.md
~~~

主な判断:

- GitをDesired StateのSource of Truthにする
- Platform Contractを薄く保つ
- Contract境界でGuardrailを置く
- Environment差分にKustomizeを使う
- Istio利用範囲を限定する
- OpenTelemetry + Jaegerを使う
- Job DomainのOwnershipを明確化する
- Local Product PoCとCloud Golden Pathを分離する
- GitHub ActionsからAWSへOIDC接続する
- Immutable SHA imageを使う

---

## 22. Operational Runbook

Runbook:

~~~text
docs/b19-operational-runbook.md
~~~

扱う内容:

- Pod Failure
- Argo CD Drift
- Unhealthy Application
- Missing Trace
- Collector / Jaeger Diagnosis
- CI Failure
- Renderer / Guardrail Failure
- Git Bot Race
- Istio Capacity Issue
- Local DB Reconstruction
- Rollback Procedure
- Incident Evidence Collection
- Recovery Exit Criteria

これはPoCのOperational Baselineであり、Production On-call Processではありません。

---

## 23. Rollbackの現在地

Rollback手順はRunbookへ記録しています。

ただし、Bad Releaseを意図的に投入し、

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

までをend-to-endで測定した実験はまだ行っていません。

したがって、Automated RollbackやValidated Rollbackは主張しません。

---

## 24. Branch Boundary

`product-poc` をそのまま `main` のCloud Deploymentへmergeできる状態ではありません。

現在のDB付きJob Serviceは:

~~~text
DATABASE_URL
~~~

を必須とします。

一方、既存Cloud CIのSmoke TestとEKS Workloadは、このDB dependencyをまだ提供していません。

そのため、

> `product-poc` を既存Cloud Golden Pathへ無条件に昇格しない。

という境界を置いています。

---

## 25. Repository Structure

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

| Path | Responsibility |
|---|---|
| `.github/workflows/` | CI / GitOps update |
| `argocd/` | Argo CD Application |
| `infra/` | Terraform / AWS Foundation |
| `job-asset-service/` | Shared Job Domain |
| `hire-api/` | Hiring-side reference service |
| `career-api/` | Candidate-side reference service |
| `database/` | Schema / Role bootstrap |
| `platform/` | Platform Contract / Renderer / Guardrail |
| `k8s/` | Kubernetes / Kustomize / Istio / Observability |
| `load-tests/` | SLI / Reliability Experiment |
| `docs/` | Experiment / ADR / Runbook |

---

## 26. B01–B20 Status

| Block | Status |
|---|---|
| B01 README | Completed |
| B02 AWS Foundation | Implemented |
| B03 EKS Runtime | Implemented / Validated |
| B04 Platform Contract | Implemented |
| B05 CI | Implemented |
| B06 GitOps | Implemented |
| B07 Argo CD | Implemented / Validated |
| B08 Kustomize | Implemented |
| B09 Istio | Minimal Implementation / Validated |
| B10 Shared Domain | Implemented |
| B11 Product PoC | Implemented Locally |
| B12 DB Ownership | Implemented / Tested |
| B13 Observability | Distributed Trace Validated |
| B14 SLI / SLO | Defined / Measured |
| B15 Reliability | Two Controlled Experiments |
| B16 Reliability Report | Documented |
| B17 Guardrail | Implemented / Tested |
| B18 ADR | Documented |
| B19 Runbook | Documented |
| B20 Demo | Not Completed |

---

## 27. Known Limitations

未実装・未検証:

- Production Authentication / Authorization
- Tenant Isolation
- Production Secrets Management
- Schema Migration Lifecycle
- PostgreSQL Backup / PITR
- Distributed Transaction Recovery
- Full API Test Coverage
- Node Failure
- AZ Failure
- DB Failure
- Kubernetes Control Plane Failure
- Multi-region Operation
- Public Production Ingress
- Long-term SLO Monitoring
- Automated Alerting
- Production On-call
- Automated Rollback
- Canary Deployment
- Progressive Delivery
- Full Service Mesh Policy
- Production Security Hardening
- Multi-team Platform Adoption
- Business Productivity Improvement

---

## 28. Design Principles

### Thin Interface

DeveloperにはInfrastructure implementationではなく、必要なintentを見せる。

### Explicit Ownership

共有されるDomain Dataにも明確なownerを持たせる。

### Git Desired State

Deployment Stateをreview可能・再現可能にする。

### Separate Reconciliation Loops

KubernetesとArgo CDが何を修復するのかを混同しない。

### User JourneyからReliabilityを見る

CPUやPodだけではなく、Userが操作を完了できるかをSLIにする。

### Fail Visibly

Self-serviceであっても、失敗理由と次の行動が分からなければPlatformとして不十分と考える。

### Evidence Before Claims

「実装した」「試した」「文書化した」「まだ試していない」を区別する。

### Small Before Generic

万能Platformを最初から作らず、最小のGolden Pathから責任境界を検証する。

---

## 29. Next — TVP v2

次のiterationでは、Platform ContractをよりBusiness / Operationに近いinterfaceへ進化させます。

候補:

~~~text
owner
serviceType
runtimeProfile
resources
routing
data dependency
secret reference
observability profile
SLO reference
runbook reference
recovery policy
~~~

ただし、項目を増やすこと自体を目的にはしません。

実際にPlatformが責任を持ち、実装・検証・説明できる範囲だけをContractへ追加します。

---

## 30. Current Status

Current branch:

~~~text
product-poc
~~~

B01〜B19は、実装・実験・設計判断・Runbookとして記録されています。

次の技術的な焦点はTVP v2のPlatform Contractです。

B20はその後、end-to-end Demoとして実施予定です。
