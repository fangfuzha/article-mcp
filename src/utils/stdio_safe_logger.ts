export const stdioSafeLogger = Object.assign(Object.create(console), {
  log: console.error.bind(console),
  info: console.error.bind(console),
}) as Console;
