# B19 — TVP Operational Runbook

Status: Active  
Scope: TVP operational recovery and diagnosis  
Primary environment: AWS EKS (`tvp-eks`, `ap-northeast-1`)

This runbook covers the failure modes that have actually been exercised or are directly supported by the current TVP. It is not a production on-call manual.

---

# 1. Operating Model

```text
GitHub
  ↓
GitHub Actions
  ↓
ECR
  ↓
GitOps manifest in Git
  ↓
Argo CD
  ↓
EKS
  ↓
Istio
  ↓
job-asset-service
```

Two reconciliation loops must be distinguished:

```text
Kubernetes
→ repairs runtime state such as missing Pods

Argo CD
→ repairs drift between Git desired state and live Kubernetes configuration
```

---

# 2. Quick Health Check

```bash
export AWS_PROFILE=tvp-terraform

aws eks update-kubeconfig   --region ap-northeast-1   --name tvp-eks

kubectl get nodes
kubectl get pods -A
kubectl get deployment job-asset-service
kubectl get pods -l app=job-asset-service -o wide

kubectl get application job-asset-service   -n argocd
```

Healthy expectation:

```text
Deployment replicas: 2
Ready replicas:      2

Argo CD:
Synced
Healthy
```

Check the application through Istio:

```bash
kubectl port-forward   -n istio-system   svc/istio-ingressgateway   18080:80
```

Then:

```bash
curl -i http://localhost:18080/health
```

Expected: HTTP 200.

---

# 3. Runbook — Pod Failure

## Symptoms

- one `job-asset-service` Pod is missing,
- a Pod is `Terminating`, `Pending`, or `CrashLoopBackOff`,
- Deployment temporarily shows fewer Ready replicas than desired.

## Diagnose

```bash
kubectl get deployment job-asset-service

kubectl get pods   -l app=job-asset-service   -o wide

kubectl describe deployment job-asset-service
```

Inspect an unhealthy Pod:

```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name> --tail=200
```

## Expected platform behavior

```text
Pod disappears
  ↓
ReplicaSet detects missing replica
  ↓
replacement Pod is created
  ↓
replacement becomes Ready
```

In the B15 experiment, replacement readiness was reached in approximately four seconds under the tested conditions.

## Recovery

Normally, do not manually recreate the Pod. Kubernetes should reconcile the Deployment automatically.

Confirm:

```bash
kubectl get deployment job-asset-service

kubectl get pods   -l app=job-asset-service   -o wide
```

Expected: 2 desired, 2 Ready.

If no replacement appears:

```bash
kubectl describe deployment job-asset-service
kubectl get events --sort-by=.lastTimestamp
kubectl get nodes
```

Investigate node capacity, image pulls, scheduling, resource pressure, and health probes.

---

# 4. Runbook — Argo CD OutOfSync / Configuration Drift

## Symptoms

Argo CD shows `OutOfSync`, or live Deployment configuration differs from Git.

## Diagnose

```bash
kubectl get application job-asset-service   -n argocd
```

Check source revision:

```bash
kubectl get application job-asset-service   -n argocd   -o jsonpath='targetRevision={.spec.source.targetRevision}{"\n"}'
```

Check self-heal:

```bash
kubectl get application job-asset-service   -n argocd   -o jsonpath='selfHeal={.spec.syncPolicy.automated.selfHeal}{"\n"}'
```

Check live Deployment:

```bash
kubectl get deployment job-asset-service   -o jsonpath='replicas={.spec.replicas} ready={.status.readyReplicas}{"\n"}'
```

## Expected platform behavior

```text
Git desired state
      !=
live cluster state
      ↓
Argo CD detects drift
      ↓
OutOfSync
      ↓
Argo CD reconciles
      ↓
Synced / Healthy
```

## Recovery

If drift was accidental, allow Argo CD to self-heal.

Do not repeatedly fight the controller using manual `kubectl` changes.

If desired state itself is wrong, fix Git rather than the live cluster.

## Important branch note

During Product PoC / Jaeger validation, Argo CD was temporarily configured to track `product-poc`.

The normal Golden Path target is intended to return to `main`.

Do not switch the revision blindly. First decide whether Product PoC changes have been merged/promoted.

---

# 5. Runbook — Application Health Check Fails

## Symptoms

`curl http://localhost:18080/health` does not return HTTP 200.

## Diagnose

```bash
kubectl get pods -n istio-system
kubectl get svc -n istio-system
```

Application:

```bash
kubectl get pods -l app=job-asset-service
kubectl logs deployment/job-asset-service --tail=200
```

Service:

```bash
kubectl get svc job-asset-service
kubectl get endpoints job-asset-service
```

Istio:

```bash
kubectl get gateway
kubectl get virtualservice
kubectl describe gateway
kubectl describe virtualservice
```

## Isolate the boundary

```bash
kubectl port-forward   svc/job-asset-service   18081:80
```

Then:

```bash
curl -i http://localhost:18081/health
```

Interpretation:

```text
direct Service works
Istio path fails
→ investigate Gateway / VirtualService / ingress gateway

direct Service fails
→ investigate application / Service / Pod
```

---

# 6. Runbook — Trace Missing in Jaeger

## Expected telemetry path

```text
Application
  ↓ OTLP HTTP
OpenTelemetry Collector
  ↓ OTLP gRPC
Jaeger
```

## Local Product PoC tunnels

Collector:

```bash
kubectl port-forward   -n default   svc/otel-collector   4318:4318
```

Jaeger UI:

```bash
kubectl port-forward   svc/jaeger   16686:16686
```

Open `http://localhost:16686`.

## Check Collector

```bash
kubectl get pods -l app=otel-collector
kubectl logs deployment/otel-collector --tail=200
```

Check whether traces arrive:

```bash
kubectl logs deployment/otel-collector   --since=2m   | grep -E 'service.name|Trace ID|Name'
```

## Check Jaeger

```bash
kubectl get pods -l app=jaeger
kubectl get svc jaeger
kubectl logs deployment/jaeger --tail=200
```

## Known tracing failure

Do not manually inject `traceparent` while automatic HTTP/fetch instrumentation is also injecting it.

The TVP previously produced a combined `traceparent` header due to double instrumentation.

Correct behavior:

```text
manual Hono server span context extraction
+
automatic outgoing fetch/HTTP propagation
```

---

# 7. Runbook — OpenTelemetry Collector Config Changed but Behavior Did Not

A ConfigMap change does not necessarily restart the existing Collector Pod.

Restart it:

```bash
kubectl delete pod   -l app=otel-collector
```

Watch replacement:

```bash
kubectl get pods   -l app=otel-collector   -w
```

Confirm logs:

```bash
kubectl logs deployment/otel-collector   --tail=100
```

---

# 8. Runbook — Jaeger UI Unavailable

```bash
kubectl get pods -l app=jaeger
kubectl get svc jaeger
kubectl logs deployment/jaeger --tail=200
```

Expected Service ports:

```text
16686  UI
4317   OTLP gRPC
4318   OTLP HTTP
```

Start UI tunnel:

```bash
kubectl port-forward   svc/jaeger   16686:16686
```

If Collector receives traces but Jaeger does not:

```bash
kubectl logs deployment/otel-collector   --since=5m   | grep -i -E 'error|fail|jaeger|4317'
```

Also:

```bash
kubectl get endpoints jaeger
```

---

# 9. Runbook — GitHub Actions / GitOps Bot Commit Race

## Symptom

A human push is rejected because the GitHub Actions bot committed a generated GitOps manifest to the same branch.

## Recovery

Do not force push.

```bash
git fetch origin

git log   --oneline   --graph   --decorate   --all   -10

git rebase origin/main

git push
```

If operating on another branch, rebase against that branch instead of `origin/main`.

---

# 10. Runbook — GitHub Actions Build / Render Failure

Check which stage failed:

```text
checkout
AWS OIDC
ECR login
Docker build
architecture verification
smoke test
push to ECR
renderer dependency install
guardrail test
render
GitOps commit
```

If the guardrail step fails, inspect the Platform Contract.

Current policy:

```text
name       → valid DNS-1123 label
type       → web
port       → 1..65535
replicas   → 1..10
build      → dockerfile
image tag  → not :latest
```

Fix the declaration rather than bypassing the guardrail.

Safe local render:

```bash
IMAGE_URI='example.invalid/tvp/job-asset-service:test' RENDER_OUTPUT_PATH='/tmp/job-asset-service.yaml' python platform/render.py
```

---

# 11. Runbook — Deployment Rollback

Because Git is the source of truth, prefer Git-based rollback.

Identify history:

```bash
git log --oneline --all -20
```

Revert the bad change:

```bash
git revert <bad-commit>
git push
```

Allow CI/Argo CD to reconcile the reverted state.

Avoid long-lived manual `kubectl set image`, `kubectl scale`, or similar imperative changes as the final recovery state. Argo CD may revert them because Git remains authoritative.

---

# 12. Runbook — Istio Installation / Capacity Failure

The default Istio control-plane request was too large for the TVP's small `t4g.small` workers.

The working installation used:

```bash
istioctl install -y   --set profile=default   --set values.gateways.istio-ingressgateway.type=ClusterIP   --set components.pilot.k8s.resources.requests.cpu=100m   --set components.pilot.k8s.resources.requests.memory=512Mi
```

Diagnose:

```bash
kubectl get pods -A
kubectl describe pod -n istio-system <pod-name>
kubectl describe node <node-name>
```

Review allocatable CPU, memory, Pod count, requests, and scheduling events.

This tuning is not a production Istio sizing recommendation.

---

# 13. Runbook — Local Product PoC Database Recovery

This section applies to the local multi-service Product PoC, not the EKS Golden Path.

Start:

```bash
docker compose   --env-file .env.product-poc   -f docker-compose.product-poc.yml   up -d
```

Full rebuild:

```bash
docker rm -f tvp-postgres 2>/dev/null || true

docker compose   --env-file .env.product-poc   -f docker-compose.product-poc.yml   down -v   --remove-orphans

docker compose   --env-file .env.product-poc   -f docker-compose.product-poc.yml   up -d
```

Bootstrap:

```text
database/init/001-schema.sql
database/init/002-roles.sh
```

Expected ownership:

```text
job_service
  can access job.jobs

hire_service
  can access hire.job_metadata
  cannot directly read job.jobs

career_service
  can access career.saved_jobs
  cannot directly read job.jobs
```

---

# 14. Incident Evidence Collection

Before changing multiple variables:

```bash
date -Iseconds

kubectl get pods -A -o wide

kubectl get deployment job-asset-service

kubectl get application job-asset-service   -n argocd

kubectl get events   --sort-by=.lastTimestamp
```

Application logs:

```bash
kubectl logs deployment/job-asset-service   --tail=200
```

Telemetry logs:

```bash
kubectl logs deployment/otel-collector   --tail=200

kubectl logs deployment/jaeger   --tail=200
```

Operating rule:

```text
observe
  ↓
isolate boundary
  ↓
change one variable
  ↓
verify recovery
```

---

# 15. Recovery Ownership Matrix

| Failure type | Primary recovery owner |
|---|---|
| Single Pod deleted | Kubernetes Deployment / ReplicaSet |
| Live Deployment drifts from Git | Argo CD |
| Invalid Platform Contract | CI / renderer guardrail |
| Bad application release | Git revert + CI + Argo CD |
| Istio routing failure | Platform operator |
| Missing trace | App instrumentation / OTel Collector / Jaeger diagnosis |
| Local DB ownership/bootstrap issue | Product PoC operator |

---

# 16. PoC Limitations

This runbook does not claim coverage for:

- worker-node loss,
- Availability Zone loss,
- multi-region recovery,
- managed database failover,
- Kubernetes control-plane failure,
- production PagerDuty/on-call integration,
- production alert thresholds,
- long-term SLO compliance.

The current TVP has experimentally validated:

```text
Pod-level Kubernetes self-healing
GitOps drift self-healing
synthetic SLI/SLO measurement
distributed tracing
Platform Contract guardrails
```

---

# 17. Exit Criteria

An incident is considered resolved when:

```text
Application:
  expected replicas Ready

Argo CD:
  Synced
  Healthy

Health endpoint:
  HTTP 200

Traffic:
  expected request success restored

Telemetry:
  traces visible when tracing is part of the incident
```

Any manual recovery that leaves Git and the cluster inconsistent is temporary and should not be treated as final resolution.
