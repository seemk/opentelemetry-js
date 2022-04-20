/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  defaultExporterTemporality,
  defaultOptions,
  OTLPMetricExporterOptions,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { AggregationTemporality, PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics-base';
import { OTLPExporterBase } from '@opentelemetry/otlp-exporter-base';
import {
  OTLPGRPCExporterConfigNode,
  OTLPGRPCExporterNodeBase,
  ServiceClientType,
  validateAndNormalizeUrl
} from '@opentelemetry/otlp-grpc-exporter-base';
import { baggageUtils, getEnv, ExportResult } from '@opentelemetry/core';
import { Metadata } from '@grpc/grpc-js';
import { createExportMetricsServiceRequest, IExportMetricsServiceRequest } from '@opentelemetry/otlp-transformer';


const DEFAULT_COLLECTOR_URL = 'localhost:4317';

class OTLPMetricExporterProxy extends OTLPGRPCExporterNodeBase<ResourceMetrics, IExportMetricsServiceRequest> {
  protected readonly _aggregationTemporality: AggregationTemporality;

  constructor(config: OTLPGRPCExporterConfigNode & OTLPMetricExporterOptions= defaultOptions) {
    super(config);
    this.metadata ||= new Metadata();
    const headers = baggageUtils.parseKeyPairsIntoRecord(getEnv().OTEL_EXPORTER_OTLP_METRICS_HEADERS);
    for (const [k, v] of Object.entries(headers)) {
      this.metadata.set(k, v);
    }
    this._aggregationTemporality = config.aggregationTemporality ?? defaultExporterTemporality;
  }

  getServiceProtoPath(): string {
    return 'opentelemetry/proto/collector/metrics/v1/metrics_service.proto';
  }

  getServiceClientType(): ServiceClientType {
    return ServiceClientType.METRICS;
  }

  getDefaultUrl(config: OTLPGRPCExporterConfigNode): string {
    return typeof config.url === 'string'
      ? validateAndNormalizeUrl(config.url)
      : getEnv().OTEL_EXPORTER_OTLP_METRICS_ENDPOINT.length > 0
        ? validateAndNormalizeUrl(getEnv().OTEL_EXPORTER_OTLP_METRICS_ENDPOINT)
        : getEnv().OTEL_EXPORTER_OTLP_ENDPOINT.length > 0
          ? validateAndNormalizeUrl(getEnv().OTEL_EXPORTER_OTLP_ENDPOINT)
          : DEFAULT_COLLECTOR_URL;
  }

  convert(metrics: ResourceMetrics[]): IExportMetricsServiceRequest {
    return createExportMetricsServiceRequest(metrics[0], this._aggregationTemporality);
  }
}


export class OTLPMetricExporterBase<T extends OTLPExporterBase<OTLPMetricExporterOptions,
  ResourceMetrics,
  IExportMetricsServiceRequest>>
  implements PushMetricExporter {
  public _otlpExporter: T;
  protected _preferredAggregationTemporality: AggregationTemporality;

  constructor(exporter: T,
              config: OTLPMetricExporterOptions = defaultOptions) {
    this._otlpExporter = exporter;
    this._preferredAggregationTemporality = config.aggregationTemporality ?? AggregationTemporality.CUMULATIVE;
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    this._otlpExporter.export([metrics], resultCallback);
  }

  async shutdown(): Promise<void> {
    await this._otlpExporter.shutdown();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  getPreferredAggregationTemporality(): AggregationTemporality {
    return this._preferredAggregationTemporality;
  }

}

export class OTLPMetricExporter extends OTLPMetricExporterBase<OTLPMetricExporterProxy>{
  constructor(config: OTLPGRPCExporterConfigNode & OTLPMetricExporterOptions = defaultOptions) {
    super(new OTLPMetricExporterProxy(config), config);
  }
}
