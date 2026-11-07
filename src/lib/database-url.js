/** Used when DATABASE_URL is unset or blank. Prisma resolves it from the prisma folder. */
export const DEFAULT_DATABASE_URL = "file:./dev.db";

/**
 * The database to use. Shared by the app and the Prisma commands, because a
 * Prisma schema cannot give an environment variable a default.
 *
 * @param {string | undefined} [value]
 * @returns {string}
 */
export function databaseUrl(value = process.env.DATABASE_URL) {
  return value?.trim() || DEFAULT_DATABASE_URL;
}
