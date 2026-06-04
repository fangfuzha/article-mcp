/**
 * 提供各学术 API 的可选身份认证参数构建辅助函数（NCBI、OpenAlex、Crossref、Semantic Scholar）。
 */

const DEFAULT_TOOL_NAME = "article-mcp";

function trimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function firstConfiguredValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = trimmedEnv(name);
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function isValidEmail(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export function normalizeDoiIdentifier(doi: string): string {
  return doi
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim();
}

export function buildNcbiParams(email?: string): Record<string, string> {
  const configuredEmail = isValidEmail(email)
    ? email
    : firstConfiguredValue("NCBI_EMAIL", "ENTREZ_EMAIL", "ARTICLE_MCP_CONTACT_EMAIL");
  const apiKey = firstConfiguredValue("NCBI_API_KEY", "ENTREZ_API_KEY");
  const params: Record<string, string> = {
    tool: firstConfiguredValue("NCBI_TOOL", "ENTREZ_TOOL") ?? DEFAULT_TOOL_NAME,
  };

  if (isValidEmail(configuredEmail)) {
    params.email = configuredEmail;
  }
  if (apiKey) {
    params.api_key = apiKey;
  }

  return params;
}

export function addOpenAlexAuthParams(params: Record<string, unknown>): Record<string, unknown> {
  const apiKey = firstConfiguredValue("OPENALEX_API_KEY");
  return apiKey ? { ...params, api_key: apiKey } : params;
}

export function getOpenAlexApiKey(): string | undefined {
  return firstConfiguredValue("OPENALEX_API_KEY");
}

export function getOpenAlexMissingApiKeyMessage(): string {
  return "OPENALEX_API_KEY 未设置。OpenAlex 当前要求 API key；请访问 https://openalex.org/account 获取并配置后再使用 OpenAlex 搜索、施引和期刊指标能力。";
}

export function buildCrossrefRequestOptions(): {
  params: Record<string, string>;
  headers: Record<string, string>;
} {
  const mailto = firstConfiguredValue("CROSSREF_MAILTO", "ARTICLE_MCP_CONTACT_EMAIL");
  const headers: Record<string, string> = {
    "User-Agent": isValidEmail(mailto) ? `Article-MCP/2.0 (mailto:${mailto})` : "Article-MCP/2.0",
  };

  return {
    params: isValidEmail(mailto) ? { mailto } : {},
    headers,
  };
}

export function buildSemanticScholarHeaders(): Record<string, string> | undefined {
  const apiKey = firstConfiguredValue("SEMANTIC_SCHOLAR_API_KEY", "S2_API_KEY");
  return apiKey ? { "x-api-key": apiKey } : undefined;
}
