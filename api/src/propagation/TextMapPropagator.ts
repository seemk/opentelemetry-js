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

import { Context } from '../context/types';

/**
 * Injects `Context` into and extracts it from carriers that travel
 * in-band across process boundaries. Encoding is expected to conform to the
 * HTTP Header Field semantics. Values are often encoded as RPC/HTTP request
 * headers.
 *
 * The carrier of propagated data on both the client (injector) and server
 * (extractor) side is usually an object such as http headers. Propagation is
 * usually implemented via library-specific request interceptors, where the
 * client-side injects values and the server-side extracts them.
 *
 * @since 1.0.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TextMapPropagator<Carrier = any> {
  /**
   * Injects values from a given `Context` into a carrier.
   *
   * OpenTelemetry defines a common set of format values (TextMapPropagator),
   * and each has an expected `carrier` type.
   *
   * @param context the Context from which to extract values to transmit over
   *     the wire.
   * @param carrier the carrier of propagation fields, such as http request
   *     headers.
   * @param setter an optional {@link TextMapSetter}. If undefined, values will be
   *     set by direct object assignment.
   */
  inject(
    context: Context,
    carrier: Carrier,
    setter: TextMapSetter<Carrier>
  ): void;

  /**
   * Given a `Context` and a carrier, extract context values from a
   * carrier and return a new context, created from the old context, with the
   * extracted values.
   *
   * @param context the Context from which to extract values to transmit over
   *     the wire.
   * @param carrier the carrier of propagation fields, such as http request
   *     headers.
   * @param getter an optional {@link TextMapGetter}. If undefined, keys will be all
   *     own properties, and keys will be accessed by direct object access.
   */
  extract(
    context: Context,
    carrier: Carrier,
    getter: TextMapGetter<Carrier>
  ): Context;

  /**
   * Return a list of all fields which may be used by the propagator.
   */
  fields(): string[];
}

/**
 * A setter is specified by the caller to define a specific method
 * to set key/value pairs on the carrier within a propagator
 *
 * @since 1.0.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TextMapSetter<Carrier = any> {
  /**
   * Callback used to set a key/value pair on an object.
   *
   * Should be called by the propagator each time a key/value pair
   * should be set, and should set that key/value pair on the propagator.
   *
   * @param carrier object or class which carries key/value pairs
   * @param key string key to modify
   * @param value value to be set to the key on the carrier
   */
  set(carrier: Carrier, key: string, value: string): void;
}

/**
 * A getter is specified by the caller to define a specific method
 * to get the value of a key from a carrier.
 *
 * @since 1.0.0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TextMapGetter<Carrier = any> {
  /**
   * Get a list of all keys available on the carrier.
   *
   * @param carrier
   */
  keys(carrier: Carrier): string[];

  /**
   * Get the value of a specific key from the carrier.
   *
   * @param carrier
   * @param key
   */
  get(carrier: Carrier, key: string): undefined | string | string[];
}

/**
 * @since 1.0.0
 */
export const defaultTextMapGetter: TextMapGetter = {
  get(carrier, key) {
    if (carrier == null) {
      return undefined;
    }
    return carrier[key];
  },

  keys(carrier) {
    if (carrier == null) {
      return [];
    }
    return Object.keys(carrier);
  },
};

/**
 * @since 1.0.0
 */
export const defaultTextMapSetter: TextMapSetter = {
  set(carrier, key, value) {
    if (carrier == null) {
      return;
    }

    carrier[key] = value;
  },
};
