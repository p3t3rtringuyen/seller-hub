// Type helpers over openapi-typescript's `operations` interface, so a typed client can derive the request and
// response of an operation from the generated types instead of hand-written DTOs (ADR-0006, conventions §1).

type Prop<O, K extends string> = O extends { [P in K]?: infer V }
  ? [V] extends [never]
    ? never
    : Exclude<V, undefined>
  : never;

/** Media-type keys only (`application/json`, `application/vnd.x+json`); some Amazon models leave stray non-media keys in `content`. */
type MediaType<C> = Extract<keyof C, `${string}/${string}`>;

type ParamsOf<Op> = Op extends { parameters: infer P } ? P : never;

type PathArg<P> = [Prop<P, "path">] extends [never] ? unknown : { path: Prop<P, "path"> };
type QueryArg<P> = [Prop<P, "query">] extends [never]
  ? unknown
  : object extends Prop<P, "query">
    ? { query?: Prop<P, "query"> }
    : { query: Prop<P, "query"> };

type BodyOf<Op> = Op extends { requestBody?: infer B }
  ? [Exclude<B, undefined>] extends [never]
    ? never
    : Exclude<B, undefined> extends { content: infer C }
      ? C[MediaType<C>]
      : never
  : never;

type RequiresBody<Op> = Op extends { requestBody: unknown } ? true : false;

type BodyArg<Op> = [BodyOf<Op>] extends [never]
  ? unknown
  : RequiresBody<Op> extends true
    ? { body: BodyOf<Op> }
    : { body?: BodyOf<Op> };

/** Arguments of a typed call: `path`, `query` and `body` appear (and are required) only when the operation has them. */
export type OperationArgs<Op> = PathArg<ParamsOf<Op>> & QueryArg<ParamsOf<Op>> & BodyArg<Op>;

type SuccessCode = 200 | 201 | 202 | 203 | 204 | 206 | 207;

/** Union of the documented success bodies (200 / 201 / 202 / 207 …). `undefined` for responses without content. */
export type OperationResponse<Op> = Op extends { responses: infer R }
  ? {
      [K in Extract<keyof R, SuccessCode>]: R[K] extends { content: infer C }
        ? C[MediaType<C>]
        : undefined;
    }[Extract<keyof R, SuccessCode>]
  : never;
