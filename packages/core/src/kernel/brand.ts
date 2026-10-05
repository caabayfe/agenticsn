declare const BRAND: unique symbol;

// A string that has passed validation. Only the type's own factory may create one.
export type Brand<T, Name extends string> = T & { readonly [BRAND]: Name };
