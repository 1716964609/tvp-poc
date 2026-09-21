import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { trace } from '@opentelemetry/api'

const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

if (endpoint) {
  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  })

  const sdk = new NodeSDK({
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
  })

  sdk.start()
  const tracer = trace.getTracer('tvp-otel-probe')

  const span = tracer.startSpan('otel-bootstrap-check')
  span.setAttribute('tvp.probe', true)
  span.end()

  console.log(`OpenTelemetry enabled: ${endpoint}`)
}
