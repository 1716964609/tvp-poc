import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

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

  console.log(
    `OpenTelemetry enabled: ${endpoint}`
  )
}