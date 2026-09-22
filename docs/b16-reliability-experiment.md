# B16 — Controlled Reliability Experiment Report

## 1. Purpose

This experiment validates two independent reconciliation mechanisms in the TVP:

1. Kubernetes runtime self-healing
2. Argo CD GitOps self-healing

The objective is not to demonstrate production-scale availability.

The objective is to verify that the platform can recover from controlled runtime failure and desired-state drift while serving continuous traffic.

---

## 2. Environment

- AWS EKS
- Kubernetes
- Istio ingress
- Argo CD with automated self-heal enabled
- `job-asset-service`
- Desired replicas: 2
- k6 traffic generator running locally

Traffic path:

~~~text
k6
  ↓
localhost:18080
  ↓ kubectl port-forward
Istio ingress on EKS
  ↓
Kubernetes Service
  ↓
job-asset-service Pods
~~~

Traffic profile:

- Constant arrival rate: 5 requests/sec
- Duration: 3 minutes
- Endpoint: `GET /jobs`

---

## 3. Experiment A — Kubernetes Pod Self-Healing

### 3.1 Hypothesis

If one of two application Pods is deleted while traffic is active:

- the remaining Pod should continue serving requests,
- Kubernetes should create a replacement Pod,
- the replacement should become Ready automatically,
- user-visible request failures should remain minimal or zero.

### 3.2 Failure Injection

At:

~~~text
2026-09-23T02:03:50+09:00
~~~

one `job-asset-service` Pod was deliberately deleted.

Initial state:

~~~text
replicas: 2
ready:    2
~~~

Deleted Pod:

~~~text
job-asset-service-54b8c754bf-4t7t9
~~~

Kubernetes immediately created:

~~~text
job-asset-service-54b8c754bf-79zs7
~~~

Timeline:

~~~text
02:03:50  Pod deleted
02:03:50  Replacement Pod started
02:03:54  Replacement Pod Ready
~~~

Observed recovery time:

~~~text
approximately 4 seconds
~~~

### 3.3 Traffic Result

~~~text
Requests:       900
Successful:     900
Failed:           0
Availability: 100%
~~~

Latency:

~~~text
Average: 42.86 ms
Median:  35.00 ms
p90:     57.02 ms
p95:     81.31 ms
Max:    527.09 ms
~~~

A request-level inspection around the failure-injection timestamp showed no failed requests.

Two elevated latency samples:

~~~text
387.285 ms
189.388 ms
~~~

occurred before the Pod deletion timestamp and therefore cannot be attributed to the injected Pod failure.

During the approximately four-second replacement window, HTTP responses continued returning status 200 and no clear failure-induced latency degradation was observed.

### 3.4 Interpretation

The Pod deletion was reconciled by Kubernetes itself.

The recovery mechanism was:

~~~text
Pod deleted
   ↓
ReplicaSet detects missing replica
   ↓
Replacement Pod created
   ↓
Replacement becomes Ready
~~~

Argo CD was not responsible for this recovery.

The experiment demonstrates Pod-level runtime self-healing under the tested 5 RPS workload.

---

## 4. Experiment B — Argo CD GitOps Self-Healing

### 4.1 Hypothesis

If the live Deployment is manually changed from the Git-defined desired state:

- Argo CD should detect the drift,
- the Application should become OutOfSync,
- automated self-heal should restore the Git-defined state,
- traffic should continue during reconciliation.

### 4.2 Initial State

Argo CD:

~~~text
selfHeal=true
~~~

Deployment:

~~~text
replicas=2
ready=2
~~~

Application:

~~~text
Synced
Healthy
~~~

### 4.3 Drift Injection

At:

~~~text
2026-09-23T02:15:00+09:00
~~~

the live Deployment was manually changed:

~~~bash
kubectl scale deployment job-asset-service --replicas=1
~~~

This intentionally created the following difference:

~~~text
Git desired state:     replicas=2
Cluster actual state:  replicas=1
~~~

### 4.4 Observed Reconciliation

Argo CD state transitioned through:

~~~text
Synced / Healthy
        ↓
OutOfSync / Healthy
        ↓
Synced / Progressing
        ↓
Synced / Healthy
~~~

Deployment state transitioned through:

~~~text
2/2
 ↓
1/1
 ↓
1/2
 ↓
2/2
~~~

Argo CD therefore detected the live-state drift and restored the Deployment to the Git-defined desired state.

### 4.5 Traffic Result

~~~text
Requests:       901
Successful:     901
Failed:           0
Availability: 100%
~~~

Latency:

~~~text
Average: 47.57 ms
Median:  39.85 ms
p90:     58.91 ms
p95:    103.92 ms
Max:    439.05 ms
~~~

No request failures were observed during the drift and reconciliation process.

The p95 latency was higher than in Experiment A, but this aggregate result alone does not establish that Argo CD reconciliation caused the increase.

### 4.6 Interpretation

This recovery mechanism was distinct from Experiment A.

~~~text
Live Deployment manually changed
        ↓
Git desired state != cluster actual state
        ↓
Argo CD detects drift
        ↓
Automated self-heal
        ↓
Git-defined replicas=2 restored
~~~

This demonstrates GitOps desired-state reconciliation rather than Kubernetes Pod-level recovery.

---

## 5. Comparison

| Experiment | Injected condition | Recovery mechanism | Requests | Failures | Result |
|---|---|---|---:|---:|---|
| A | Pod deletion | Kubernetes ReplicaSet / Deployment controller | 900 | 0 | PASS |
| B | Deployment replicas 2 → 1 | Argo CD automated self-heal | 901 | 0 | PASS |

The experiments demonstrate two separate control loops:

~~~text
Kubernetes
= runtime-state reconciliation

Argo CD
= Git desired-state reconciliation
~~~

Both maintained request availability under the tested workload.

---

## 6. What This Experiment Proves

Within the tested environment and workload:

- a single Pod can be removed without observed request loss,
- Kubernetes automatically restores the missing replica,
- replacement Pod readiness was reached in approximately four seconds,
- configuration drift from Git can be detected by Argo CD,
- Argo CD automatically restores the declared desired state,
- both reconciliation mechanisms operated while continuous traffic was active.

---

## 7. What This Experiment Does NOT Prove

This experiment does not demonstrate:

- production-scale availability,
- HERP production reliability,
- worker-node failure resilience,
- Availability Zone failure resilience,
- database failure recovery,
- Kubernetes control-plane failure recovery,
- behavior under high load,
- long-term SLO compliance.

The workload was synthetic:

~~~text
5 RPS
3 minutes per experiment
~~~

and should be interpreted only as a controlled TVP reliability validation.

The application Pods were also observed on the same Kubernetes worker node during the experiment.

Therefore:

~~~text
Pod-level failure resilience: validated

Node-level failure resilience: not validated
AZ-level failure resilience:   not validated
~~~

---

## 8. Lessons Learned

### 8.1 Self-Healing Exists at Different Layers

"Self-healing" is not one mechanism.

A missing Pod is repaired by Kubernetes controllers.

A Deployment that differs from the Git-defined desired state is repaired by Argo CD.

Understanding which control loop owns which failure is important when diagnosing platform behavior.

### 8.2 Redundancy Protects the Request Path

Maintaining two replicas allowed one application instance to continue serving traffic while the other was removed and recreated.

The experiment demonstrates the practical relationship between:

- Deployment replica configuration,
- Service routing,
- readiness,
- Kubernetes reconciliation.

### 8.3 GitOps Provides a Separate Reconciliation Boundary

Argo CD did not repair the deleted Pod in Experiment A.

Instead, Kubernetes handled runtime state.

Argo CD became relevant when the Deployment specification itself drifted from the Git-defined desired state.

This distinction is important:

~~~text
Kubernetes
→ reconciles runtime resources

Argo CD
→ reconciles declared Git desired state
~~~

### 8.4 Reliability Claims Must Remain Bounded by Evidence

Zero failures across 1,801 controlled requests does not establish production availability.

The valid claim is:

> Under a controlled 5 RPS synthetic workload, no request loss was observed during the tested Pod failure and GitOps drift scenarios.

---

## 9. Follow-Up Actions

The current TVP intentionally stops short of broader failure testing.

Possible future experiments include:

- worker-node failure,
- database unavailability,
- dependency timeout,
- latency injection,
- resource exhaustion,
- higher-load capacity testing,
- graceful degradation,
- circuit breaking.

These are optional extensions rather than requirements for the current TVP.

---

## 10. Result

~~~text
B15-A Kubernetes Pod Self-Healing: PASS
B15-B Argo CD GitOps Self-Healing: PASS

B16 Controlled Reliability Experiment: COMPLETE
~~~
