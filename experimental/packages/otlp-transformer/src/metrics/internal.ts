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
import { AggregationTemporality, ValueType } from '@opentelemetry/api-metrics';
import { hrTimeToNanoseconds } from '@opentelemetry/core';
import { AggregatorKind, DataPoint, Histogram, InstrumentType, MetricData } from '@opentelemetry/sdk-metrics-base-wip';
import { toAttributes } from '../common/internal';
import { EAggregationTemporality, IGauge, IHistogram, IHistogramDataPoint, IMetric, INumberDataPoint, ISum } from './types';

export function toMetric(metric: MetricData, startTime: number, aggregationTemporality: AggregationTemporality): IMetric {
  const out: IMetric = {
    description: metric.descriptor.description,
    name: metric.descriptor.name,
    unit: metric.descriptor.unit,
  };

  if (metric.descriptor.type === InstrumentType.OBSERVABLE_GAUGE) {
    out.gauge = toGauge(metric, startTime);
  } if (metric.aggregation === AggregatorKind.SUM) {
    out.sum = toSum(metric, startTime, aggregationTemporality);
  } if (metric.aggregation === AggregatorKind.HISTOGRAM) {
    out.histogram = toHistogram(metric, startTime, aggregationTemporality);
  }

  return out;
}

function toAggregationTemporality(
  aggregationTemporality: AggregationTemporality
): EAggregationTemporality {
  if (aggregationTemporality === AggregationTemporality.AGGREGATION_TEMPORALITY_DELTA) {
    return EAggregationTemporality.AGGREGATION_TEMPORALITY_DELTA;
  }

  if (aggregationTemporality === AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE) {
    return EAggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE;
  }

  return EAggregationTemporality.AGGREGATION_TEMPORALITY_UNSPECIFIED;
}

function toGauge(
  metric: MetricData,
  startTime: number,
): IGauge {
  return {
    dataPoints: toDataPoints(metric, startTime),
  };
}

function toSum(
  metric: MetricData,
  startTime: number,
  aggregationTemporality: AggregationTemporality
): ISum {
  return {
    dataPoints: toDataPoints(metric, startTime),
    isMonotonic:
      metric.descriptor.type === InstrumentType.COUNTER ||
      metric.descriptor.type === InstrumentType.OBSERVABLE_COUNTER,
    aggregationTemporality: toAggregationTemporality(aggregationTemporality),
  };
}

function toHistogram(
  metric: MetricData,
  startTime: number,
  aggregationTemporality: AggregationTemporality
): IHistogram {
  return {
    dataPoints: toHistogramDataPoints(metric, startTime),
    aggregationTemporality: toAggregationTemporality(aggregationTemporality),
  };
}

function toDataPoints(
  metric: MetricData,
  startTime: number,
): INumberDataPoint[] {
  return metric.dataPoints.map(point => {
    const numberDataPoint: INumberDataPoint = {
      attributes: toAttributes(point.attributes),
      startTimeUnixNano: startTime,
      timeUnixNano: hrTimeToNanoseconds(point.endTime)
    };

    if (metric.descriptor.valueType === ValueType.INT ||
        metric.descriptor.valueType === ValueType.DOUBLE) {
      numberDataPoint.asInt = point.value as number;
    }

    return numberDataPoint;
  });
}

function toHistogramDataPoints(
  metric: MetricData,
  startTime: number,
): IHistogramDataPoint[] {
  return metric.dataPoints.map(point => {
    const histogramPoint = point as DataPoint<Histogram>;
    return {
      attributes: toAttributes(point.attributes),
      bucketCounts: histogramPoint.value.buckets.counts,
      explicitBounds: histogramPoint.value.buckets.boundaries,
      count: histogramPoint.value.count,
      sum: histogramPoint.value.sum,
      startTimeUnixNano: startTime,
      timeUnixNano: hrTimeToNanoseconds(point.endTime),
    };
  });
}
