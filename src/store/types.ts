export type Loadable<T> = {
  data?: T;
  loading?: boolean;
  error?: Error;
};
