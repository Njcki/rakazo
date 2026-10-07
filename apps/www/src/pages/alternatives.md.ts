import type { APIRoute } from "astro";
import { alternativesIndexMarkdown } from "../alternatives";
import { markdownResponse } from "../agent-content";

export const GET: APIRoute = ({ request }) =>
  markdownResponse(alternativesIndexMarkdown(), request.method);
