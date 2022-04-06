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
import { ExportResult, ExportResultCode, BindOnceFuture } from '@opentelemetry/core';
import {
  //OTLPExporterError,
  //OTLPExporterConfigBase,
  ExportServiceError,
} from './types';
import {
  OTLPExporterConfigNode,
  //OTLPExporterNodeBase,
  ServiceClientType,
  validateAndNormalizeUrl
} from '@opentelemetry/exporter-trace-otlp-grpc';
import { Attributes, diag } from '@opentelemetry/api';
import { createExportMetricsServiceRequest, IExportMetricsServiceRequest } from '@opentelemetry/otlp-transformer';
import { baggageUtils, getEnv } from '@opentelemetry/core';
import { Metadata } from '@grpc/grpc-js';

const DEFAULT_COLLECTOR_URL = 'localhost:4317';


export class OTLPMetricExporter implements PushMetricExporter {
  public readonly url: string;
  public readonly hostname: string | undefined;
  public readonly attributes?: Attributes;
  protected _concurrencyLimit: number;
  protected _sendingPromises: Promise<unknown>[] = [];
  protected _shutdownOnce: BindOnceFuture<void>;

  protected readonly _aggregationTemporality: AggregationTemporality;
  grpcQueue: GRPCQueueItem<>[] = [];
  metadata?: Metadata;
  serviceClient?: ServiceClient = undefined;
  private _send!: Function;
  compression: CompressionAlgorithm;

  onInit(config: OTLPExporterConfigNode): void {
    // defer to next tick and lazy load to avoid loading grpc too early
    // and making this impossible to be instrumented
    setImmediate(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { onInit } = require('./util');
      onInit(this, config);
    });
  }

  onShutdown(): void {
    if (this.serviceClient) {
      this.serviceClient.close();
    }
  }

  constructor(config: OTLPExporterConfigNode & OTLPMetricExporterOptions = defaultOptions) {
    // 1
    this.url = this.getDefaultUrl(config);
    if (typeof config.hostname === 'string') {
      this.hostname = config.hostname;
    }

    this.attributes = config.attributes;

    this.shutdown = this.shutdown.bind(this);
    this._shutdownOnce = new BindOnceFuture(this._shutdown, this);

    this._concurrencyLimit =
      typeof config.concurrencyLimit === 'number'
        ? config.concurrencyLimit
        : Infinity;

    // platform dependent
    this.onInit(config);

    // 2
    this.compression = configureCompression(config.compression);
    this.metadata ||= new Metadata();
    const headers = baggageUtils.parseKeyPairsIntoRecord(getEnv().OTEL_EXPORTER_OTLP_METRICS_HEADERS);
    for (const [k, v] of Object.entries(headers)) {
      this.metadata.set(k, v);
    }
    this._aggregationTemporality = config.aggregationTemporality ?? defaultExporterTemporality;
  }

  getServiceClientType(): ServiceClientType {
    return ServiceClientType.METRICS;
  }

  getDefaultUrl(config: OTLPExporterConfigNode): string {
    return typeof config.url === 'string'
      ? validateAndNormalizeUrl(config.url)
      : getEnv().OTEL_EXPORTER_OTLP_METRICS_ENDPOINT.length > 0
        ? validateAndNormalizeUrl(getEnv().OTEL_EXPORTER_OTLP_METRICS_ENDPOINT)
        : getEnv().OTEL_EXPORTER_OTLP_ENDPOINT.length > 0
          ? validateAndNormalizeUrl(getEnv().OTEL_EXPORTER_OTLP_ENDPOINT)
          : DEFAULT_COLLECTOR_URL;
  }

  convert(metrics: ResourceMetrics[]): IExportMetricsServiceRequest[] {
    return metrics
      .map(resourceMetrics => createExportMetricsServiceRequest(resourceMetrics, this._aggregationTemporality))
      .filter((request): request is IExportMetricsServiceRequest => request !== null);
  }

  /* PushMetricExporter */
  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void) {
    if (this._shutdownOnce.isCalled) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('Exporter has been shutdown'),
      });
      return;
    }

    if (this._sendingPromises.length >= this._concurrencyLimit) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('Concurrent export limit reached'),
      });
      return;
    }

    this._export(items)
      .then(() => {
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch((error: ExportServiceError) => {
        resultCallback({ code: ExportResultCode.FAILED, error });
      });
  }

  private _export(metrics: ResourceMetrics): Promise<unknown> {
    return new Promise<void>((resolve, reject) => {
      try {
        diag.debug('metrics to be sent', metrics);
        this.send(metrics, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  send(
    metrics: ResourceMetrics,
    onSuccess: () => void,
    onError: (error: otlpTypes.OTLPExporterError) => void
  ): void {
    if (this._shutdownOnce.isCalled) {
      diag.debug('Shutdown already started. Cannot send objects');
      return;
    }
    if (!this._send) {
      // defer to next tick and lazy load to avoid loading grpc too early
      // and making this impossible to be instrumented
      setImmediate(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { send } = require('./util');
        this._send = send;

        this._sendPromise(metrics, onSuccess, onError);
      });
    } else {
      this._sendPromise(metrics, onSuccess, onError);
    }
  }

  private _sendPromise(
    metrics: ResourceMetrics,
    onSuccess: () => void,
    onError: (error: otlpTypes.OTLPExporterError) => void
  ): void {
    const promise = new Promise<void>((resolve, reject) => {
      this._send(this, objects, resolve, reject);
    })
      .then(onSuccess, onError);

    this._sendingPromises.push(promise);
    const popPromise = () => {
      const index = this._sendingPromises.indexOf(promise);
      this._sendingPromises.splice(index, 1);
    };
    promise.then(popPromise, popPromise);
  }

  forceFlush(): Promise<void> {

  }

  getPreferredAggregationTemporality(): AggregationTemporality {

  }

  shutdown(): Promise<void> {
    return this._shutdownOnce.call();
  }

  /**
   * Called by _shutdownOnce with BindOnceFuture
   */
  private _shutdown(): Promise<void> {
    diag.debug('shutdown started');
    this.onShutdown();
    return Promise.all(this._sendingPromises)
      .then(() => {
        /** ignore resolved values */
      });
  }
}
