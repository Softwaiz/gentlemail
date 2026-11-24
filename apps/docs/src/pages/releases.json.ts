import type { APIRoute } from "astro";
import { releases } from "../lib/releases";

export const GET: APIRoute = () => new Response(JSON.stringify({ releases: releases() }), { headers: { "Content-Type": "application/json" } });
