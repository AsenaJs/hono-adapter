export type HonoDevtoolsStepKind =
  | 'global-middleware'
  | 'middleware'
  | 'validator'
  | 'controller'
  | 'catch'
  | 'config-onError'
  | 'adapter-default'
  | 'not-found';

export interface HonoDevtoolsStep {
  kind: HonoDevtoolsStepKind;
  name: string;
}

/**
 * The members of core's devtools bus this adapter relies on, declared structurally so the adapter
 * builds against a core that has no devtools. `AsenaServer.start()` hands each adapter its own
 * server's view of the bus through {@link HonoAdapter.attachDevtools}, only in a process
 * `asena console` spawned.
 *
 * @typeParam R - The record `open()` returns; opaque to the adapter
 */
export interface HonoDevtoolsBus<R extends object = object> {
  readonly enabled: boolean;
  open(method: string, path: string): R;
  run<T>(record: R, fn: () => T): T;
  step(kind: HonoDevtoolsStepKind, name: string): void;
  close(record: R, status: number, answeredBy?: HonoDevtoolsStep): void;
}
