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

import { ExportResultCode } from '@opentelemetry/core';
import {
  AggregationTemporality,
  InstrumentType,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics-base';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { collect, mockCounter, mockObservableGauge, setUp, shutdown } from '../metricsHelper';
import { OTLPExporterBase, OTLPExporterConfigBase } from '@opentelemetry/otlp-exporter-base';
import { IExportMetricsServiceRequest } from '@opentelemetry/otlp-transformer';
import { OTLPMetricExporterBase } from '../../src/OTLPMetricExporterBase';

type CollectorExporterConfig = OTLPExporterConfigBase;
class OTLPMetricExporter extends OTLPExporterBase<
  CollectorExporterConfig,
  ResourceMetrics,
  IExportMetricsServiceRequest
> {
  onInit() {}
  onShutdown() {}
  send() {}
  getDefaultUrl(config: CollectorExporterConfig) {
    return config.url || '';
  }
  convert(metrics: ResourceMetrics[]): IExportMetricsServiceRequest {
    return { resourceMetrics: [] };
  }
}

class PushExporter extends OTLPMetricExporterBase<OTLPMetricExporter> {}

describe('OTLPMetricExporter - common', () => {
  let collectorExporter: OTLPMetricExporter;
  let collectorExporterConfig: CollectorExporterConfig;
  let metrics: ResourceMetrics;

  beforeEach(() => {
    setUp();
  });

  afterEach(async () => {
    await shutdown();
    sinon.restore();
  });

  describe('constructor', () => {
    let onInitSpy: any;

    beforeEach(async () => {
      onInitSpy = sinon.stub(OTLPMetricExporter.prototype, 'onInit');
      collectorExporterConfig = {
        hostname: 'foo',
        attributes: {},
        url: 'http://foo.bar.com',
      };
      collectorExporter = new OTLPMetricExporter(collectorExporterConfig);
      const counter = mockCounter();
      mockObservableGauge(
        observableResult => {
          observableResult.observe(3, {});
          observableResult.observe(6, {});
        },
        'double-observable-gauge3'
      );
      counter.add(1);

      metrics = await collect();
    });

    it('should create an instance', () => {
      assert.ok(typeof collectorExporter !== 'undefined');
    });

    it('should call onInit', () => {
      assert.strictEqual(onInitSpy.callCount, 1);
    });

    describe('when config contains certain params', () => {
      it('should set hostname', () => {
        assert.strictEqual(collectorExporter.hostname, 'foo');
      });

      it('should set url', () => {
        assert.strictEqual(collectorExporter.url, 'http://foo.bar.com');
      });
    });

    describe('when config is missing certain params', () => {
      beforeEach(() => {
        collectorExporter = new OTLPMetricExporter();
      });
    });
  });

  describe('export', () => {
    let spySend: any;
    beforeEach(() => {
      spySend = sinon.stub(OTLPMetricExporter.prototype, 'send');
      collectorExporter = new OTLPMetricExporter(collectorExporterConfig);
    });

    it('should export metrics as otlpTypes.Metrics', done => {
      collectorExporter.export([metrics], () => {});
      setTimeout(() => {
        const metric1 = spySend.args[0][0][0] as ResourceMetrics;
        assert.deepStrictEqual(metrics, metric1);
        done();
      });
      assert.strictEqual(spySend.callCount, 1);
    });

    describe('when exporter is shutdown', () => {
      it(
        'should not export anything but return callback with code' +
          ' "FailedNotRetryable"',
        async () => {
          await collectorExporter.shutdown();
          spySend.resetHistory();

          const callbackSpy = sinon.spy();
          collectorExporter.export([metrics], callbackSpy);
          const returnCode = callbackSpy.args[0][0];
          assert.strictEqual(
            returnCode.code,
            ExportResultCode.FAILED,
            'return value is wrong'
          );
          assert.strictEqual(spySend.callCount, 0, 'should not call send');
        }
      );
    });
    describe('when an error occurs', () => {
      it('should return failed export result', done => {
        spySend.throws({
          code: 600,
          details: 'Test error',
          metadata: {},
          message: 'Non-Retryable',
          stack: 'Stack',
        });
        const callbackSpy = sinon.spy();
        collectorExporter.export([metrics], callbackSpy);
        setTimeout(() => {
          const returnCode = callbackSpy.args[0][0];
          assert.strictEqual(
            returnCode.code,
            ExportResultCode.FAILED,
            'return value is wrong'
          );
          assert.strictEqual(
            returnCode.error.message,
            'Non-Retryable',
            'return error message is wrong'
          );
          assert.strictEqual(spySend.callCount, 1, 'should call send');
          done();
        });
      });
    });
  });

  describe('shutdown', () => {
    let onShutdownSpy: any;
    beforeEach(() => {
      onShutdownSpy = sinon.stub(
        OTLPMetricExporter.prototype,
        'onShutdown'
      );
      collectorExporterConfig = {
        hostname: 'foo',
        attributes: {},
        url: 'http://foo.bar.com',
      };
      collectorExporter = new OTLPMetricExporter(collectorExporterConfig);
    });

    it('should call onShutdown', async () => {
      await collectorExporter.shutdown();
      assert.strictEqual(onShutdownSpy.callCount, 1);
    });
  });

  describe('temporality selection', () => {
    const ALL_INSTRUMENT_TYPES = Object.values(InstrumentType);

    it('chooses cumulative temporality selector by default', () => {
      const exporter = new PushExporter(new OTLPMetricExporter());

      assert(
        ALL_INSTRUMENT_TYPES.every(
          instrumentType =>
            exporter.selectAggregationTemporality(instrumentType) === AggregationTemporality.CUMULATIVE
        )
      );
    });
    it('chooses delta temporality selector for delta temporality preference', () => {
      const exporter = new PushExporter(new OTLPMetricExporter(), {
        temporalityPreference: AggregationTemporality.DELTA
      });

      assert.strictEqual(
        exporter.selectAggregationTemporality(InstrumentType.COUNTER),
        AggregationTemporality.DELTA
      );

      assert.strictEqual(
        exporter.selectAggregationTemporality(InstrumentType.OBSERVABLE_COUNTER),
        AggregationTemporality.DELTA
      );

      assert.strictEqual(
        exporter.selectAggregationTemporality(InstrumentType.HISTOGRAM),
        AggregationTemporality.DELTA
      );

      assert.strictEqual(
        exporter.selectAggregationTemporality(InstrumentType.OBSERVABLE_GAUGE),
        AggregationTemporality.DELTA
      );

      assert.strictEqual(
        exporter.selectAggregationTemporality(InstrumentType.UP_DOWN_COUNTER),
        AggregationTemporality.CUMULATIVE
      );
      assert.strictEqual(
        exporter.selectAggregationTemporality(InstrumentType.OBSERVABLE_UP_DOWN_COUNTER),
        AggregationTemporality.CUMULATIVE
      );
    });
  });
});
