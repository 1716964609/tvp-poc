# TVP — Thinnest Viable Platform

アプリケーション開発者が扱うインターフェースを小さく保ちながら、Build / Deploy / Run / Observe の共通部分をPlatform側へ集約するためのDeveloper Platform PoCです。

この `main` branchでは、TVPの中核となる **Core Cloud Golden Path** を扱います。

DeveloperがAWS / EKS / ECR / Kubernetes / GitOpsの詳細を毎回直接操作するのではなく、

**code + `platform.yaml` + git push**

を入口として、Platform側が共通の配布経路を引き受ける構成を検証しています。

> 本リポジトリは技術検証用PoCです。Production-ready Platformを示すものではありません。

---

## 1. このbranchで確認したこと

`main` では、以下のCore Platform Flowを実装・検証しました。

- TerraformによるAWS Foundation
- Amazon EKS上でのApplication Runtime
- ARM64 Container Image
- Amazon ECR
- GitHub Actions
- GitHub OIDCによるAWS認証
- Platform Contract
- ContractからのKubernetes Manifest生成
- GitをDesired StateとするGitOps
- Argo CDによるEKSへの反映
- KustomizeによるEnvironment差分
- Istioによる最小限のHTTP Routing
- OpenTelemetry instrumentationの入口

一方、このbranchだけでは以下を実証していません。

- Production Traffic
- Node Failure
- AZ Failure
- DB Failure
- Automated Rollback
- Canary / Progressive Delivery
- Long-term SLO
- Production Alert / On-call
- Multi-team Platform Adoption

より深いDomain / Observability / Reliabilityの検証は `product-poc` branchで扱っています。

---

## 2. TVPの目的

TVPが検証する中心的な問いは次です。

> DeveloperがInfrastructureの詳細を毎回理解・操作しなくても、安全にBuild / Deploy / Run / Observeできる最小のPlatform interfaceはどこまで薄くできるか。

Developer側の入口は意図的に小さくしています。

~~~text
code
+
platform.yaml
+
git push
~~~

その後の共通処理をPlatform側へ寄せます。

---

## 3. Golden Path

~~~mermaid
flowchart LR

    Dev["Developer<br/>code + platform.yaml"]
    GitHub["GitHub"]
    CI["GitHub Actions"]
    ECR["Amazon ECR"]
    Desired["Git Desired State"]
    Argo["Argo CD"]
    EKS["Amazon EKS"]
    Istio["Istio Gateway"]
    Service["Kubernetes Service"]
    Pods["Application Pods"]
    OTel["OpenTelemetry"]

    Dev --> GitHub
    GitHub --> CI

    CI --> ECR
    CI --> Desired

    Desired --> Argo
    Argo --> EKS
    ECR --> EKS

    Istio --> Service
    Service --> Pods

    Pods --> OTel
~~~

Control Plane上の流れと、Application Requestの流れは分けて考えています。

### Deployment Control Flow

~~~text
Source Change
    ↓
GitHub Actions
    ↓
Container Image
    ↓
Amazon ECR
    ↓
Generated Manifest
    ↓
Git Desired State
    ↓
Argo CD
    ↓
Amazon EKS
~~~

### Request Flow

~~~text
HTTP Client
    ↓
Istio Gateway
    ↓
VirtualService
    ↓
Kubernetes Service
    ↓
Application Pod
~~~

この二つは障害点も責任も異なります。

---

## 4. Platform Contract

現在のDeveloper-facing Contractは次です。

~~~yaml
name: job-asset-service
type: web
port: 8080
replicas: 2

build:
  strategy: dockerfile
~~~

DeveloperはInfrastructure Manifestそのものではなく、Applicationの実行意図を宣言します。

renderer:

~~~text
platform/render.py
~~~

がContractを読み取り、Kubernetes Deployment / Serviceへ変換します。

現時点では単一service向けの薄いinterfaceであり、汎用的なPlatform APIではありません。

---

## 5. Technology Stack

| Area | Technology |
|---|---|
| Cloud | AWS |
| Infrastructure as Code | Terraform |
| Container | Docker |
| Registry | Amazon ECR |
| Kubernetes | Amazon EKS |
| CI | GitHub Actions |
| AWS Authentication | GitHub OIDC |
| GitOps | Argo CD |
| Environment差分 | Kustomize |
| Routing | Istio |
| Application | TypeScript / Hono |
| Observability Interface | OpenTelemetry |

技術を増やすこと自体を目的にはしていません。

一つのGolden PathをEnd-to-Endで理解・検証できることを優先しています。

---

## 6. AWS Foundation

TerraformでPoC用のAWS Foundationを管理しています。

主な対象:

- VPC
- Subnet
- IAM
- Amazon EKS
- Managed Node Group
- Amazon ECR
- GitHub Actions OIDC

保存されているPoC構成の主な値:

~~~text
Region:
ap-northeast-1

VPC:
10.10.0.0/16

Subnets:
10.10.1.0/24
10.10.2.0/24

EKS:
tvp-eks

Worker Architecture:
ARM64

Worker Instance:
t4g.small

ECR:
IMMUTABLE tags
scan_on_push = true
~~~

Workerは小規模PoC向けです。

この構成をProduction sizingとして一般化しません。

---

## 7. CI

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
Architecture確認
    ↓
/health Smoke Test
    ↓
ECR Push
    ↓
Platform Validation
    ↓
Manifest Render
    ↓
GitOps Commit
~~~

Container Imageにはsource Git SHAをtagとして使用します。

ECRはimmutable tag設定です。

重要な責任分離として、GitHub ActionsはECRへImageをpublishしますが、Kubernetesへ直接deployしません。

---

## 8. GitOps

ApplicationのDesired StateはGitで管理します。

~~~text
k8s/
├── base/
└── overlays/
    ├── dev/
    └── prod/
~~~

責任を次のように分離しています。

~~~text
Kustomize
    ↓
Manifestを組み立てる

Argo CD
    ↓
Git Desired StateとLive Stateを比較・同期する

Kubernetes
    ↓
宣言されたRuntime Stateを維持する
~~~

`prod` overlayが存在することは、Production Environmentとして検証済みであることを意味しません。

---

## 9. Source CommitとDeploy Commit

CIはApplicationのSource SHAをContainer Image tagとして使用し、そのImageを参照するManifestを別のGit commitとして記録します。

そのため、Git履歴では例えば次のようになります。

~~~text
0757c08
Instrument HTTP requests with OpenTelemetry
        ↓
310aed8
Deploy 0757c08...
~~~

これは異常ではありません。

Application Source RevisionとGitOps Desired State Revisionは異なる責任を持つためです。

障害調査時には、

~~~text
Source SHA
Container Image
Generated Manifest
Argo CD Sync Revision
Live Workload
~~~

を対応づけて確認します。

---

## 10. Kustomize

KustomizeはEnvironmentごとの差分を管理します。

~~~text
base
├── common Deployment
└── common Service

overlays/dev
└── development configuration

overlays/prod
└── production-like configuration example
~~~

Kustomize自体はLive Stateを監視するControllerではありません。

Manifestの生成・構成と、Runtime Reconciliationを分離しています。

---

## 11. Istio

Istioの利用範囲は意図的に最小限です。

~~~text
HTTP
    ↓
Istio Gateway
    ↓
VirtualService
    ↓
job-asset-service
~~~

Local access例:

~~~bash
kubectl port-forward -n istio-system \
  svc/istio-ingressgateway 18080:80
~~~

~~~bash
curl -i http://localhost:18080/health
~~~

未実装・未検証:

- mTLS policy
- retry
- circuit breaker
- rate limit
- canary
- public LoadBalancer
- public HTTPS ingress

Service Meshの機能を全部使うことではなく、Routing責任の境界を確認することを目的にしています。

---

## 12. OpenTelemetry

ApplicationにはOpenTelemetry instrumentationを導入しています。

このbranchでの目的は、Application側からObservability Backendを直接固定するのではなく、Telemetryの共通interfaceを持つことです。

~~~text
Application
    ↓
OpenTelemetry
    ↓
Observability Backend
~~~

より詳細なDistributed TracingとJaegerによる検証は `product-poc` branchで扱っています。

---

## 13. Repository Structure

~~~text
.
├── .github/workflows/
├── argocd/
├── infra/
├── job-asset-service/
├── k8s/
│   ├── base/
│   └── overlays/
└── platform/
~~~

| Path | Responsibility |
|---|---|
| `.github/workflows/` | CI / GitOps update |
| `argocd/` | Argo CD Application |
| `infra/` | AWS / Terraform Foundation |
| `job-asset-service/` | Reference Application / Platform Contract |
| `platform/` | Contract Renderer |
| `k8s/base/` | Common Kubernetes Resources |
| `k8s/overlays/` | Environment差分 |

---

## 14. Local Validation

Platform renderer用のPython環境:

~~~bash
python3 -m venv .venv-platform
source .venv-platform/bin/activate
pip install -r platform/requirements.txt
~~~

tracked fileを変更せずに一時出力する例:

~~~bash
IMAGE_URI=example.invalid/tvp/job-asset-service:dev \
RENDER_OUTPUT_PATH=/tmp/job-asset-service.yaml \
python platform/render.py
~~~

Kustomizeの確認:

~~~bash
kubectl kustomize k8s/overlays/dev
~~~

Terraform:

~~~bash
terraform -chdir=infra init
terraform -chdir=infra plan
~~~

実際のAWS変更には適切なCredentialとEnvironmentが必要です。

---

## 15. 責任境界

TVPでは、すべてをPlatformへ押し込まないことも重要と考えています。

### Application側

- Domain Logic
- API behavior
- Application-specific data
- Business correctness

### Platform側

- Contract validation
- Build / Delivery path
- Common Runtime configuration
- GitOps integration
- Routing entry point
- Observability entry point

### Argo CD

- Git Desired StateとのReconciliation

### Kubernetes

- Runtime StateのReconciliation

同じ「自動化」でも責任は分けています。

---

## 16. Design Principles

### Thin Interface

DeveloperにはInfrastructureの実装詳細ではなく、必要なintentを見せる。

### Git Desired State

Deployment Stateをreview可能・追跡可能にする。

### Immutable Artifact

Source SHAとContainer Imageを対応づける。

### Separate Lifecycles

TerraformによるFoundationとApplication Deliveryを同じ変更周期にしない。

### Separate Reconciliation Loops

Argo CDとKubernetesが何を修復するのかを混同しない。

### Small Before Generic

最初から万能Platformを作らず、一つのGolden PathをEnd-to-Endで成立させる。

### Evidence Before Claims

構成ファイルが存在することと、実際に検証したことを分ける。

---

## 17. Branches

### `main`

Core Cloud Golden Pathを扱います。

~~~text
Platform Contract
    ↓
CI
    ↓
ECR
    ↓
GitOps
    ↓
Argo CD
    ↓
EKS
    ↓
Istio
~~~

### `product-poc`

Core TVPをさらに拡張し、以下を扱います。

- Mock Hire / Mock Career / Job Asset Service
- Domain Ownership
- PostgreSQL schema / role separation
- OpenTelemetry Distributed Tracing
- Jaeger
- SLI / SLO
- k6
- Kubernetes Self-Healing
- Argo CD Self-Healing
- Guardrail
- ADR
- Operational Runbook

より詳細な技術検証を見る場合は `product-poc` branchを参照してください。

---

## 18. Known Limitations

このPoCでは以下をProduction-readyとして検証していません。

- Private Production Network Architecture
- Production Authentication / Authorization
- Production Secrets Management
- Node Failure
- AZ Failure
- DB Failure
- Multi-region
- Production-scale Traffic
- Long-term SLO
- Production Alerting
- On-call
- Automated Rollback
- Canary
- Progressive Delivery
- Complete Kubernetes Security Policy
- Multi-team Platform Adoption

このbranchの目的は、最小のDeveloper Platform Golden Pathと責任境界を実装・説明できる状態にすることです。

---

## 19. Current Status

Core Cloud Golden Pathは実装・検証済みです。

~~~text
Developer
    ↓
code + platform.yaml + git push
    ↓
CI
    ↓
ECR
    ↓
Git Desired State
    ↓
Argo CD
    ↓
EKS
~~~

次の技術的なiterationでは、Platform Contractをより実際の運用・責任境界に近い形へ拡張する予定です。

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

ただし、項目数を増やすこと自体を目的にはしません。

Platformが実際に責任を持ち、実装・検証できる範囲だけをContractへ追加していきます。
