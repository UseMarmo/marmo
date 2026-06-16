import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

export const sql = postgres(DATABASE_URL, { prepare: false, ssl: "require", max: 5 });
