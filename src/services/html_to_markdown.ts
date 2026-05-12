/**
 * 将 HTML 或 XML 片段转换为 Markdown。
 *
 * @param htmlContent HTML 或 XML 字符串。
 * @returns 转换后的 Markdown；输入为空时返回 null。
 */
export function htmlToMarkdown(htmlContent: string): string | null {
  if (!htmlContent) {
    return null;
  }

  const normalized = normalizeMarkup(htmlContent);
  const markdown = cleanupMarkdown(
    stripRemainingTags(
      convertInlineFormatting(convertLists(convertParagraphs(convertTitles(normalized)))),
    ),
  );

  return markdown || null;
}

/**
 * 将 HTML 或 XML 片段转换为纯文本。
 *
 * @param htmlContent HTML 或 XML 字符串。
 * @returns 转换后的纯文本；输入为空时返回 null。
 */
export function htmlToText(htmlContent: string): string | null {
  if (!htmlContent) {
    return null;
  }

  const normalized = normalizeMarkup(htmlContent)
    .replace(/<title\b[^>]*>([\s\S]*?)<\/title>/gi, (_match, title: string) => {
      const text = decodeEntities(stripMarkup(title));
      return text ? `\n\n${text}\n\n` : "\n\n";
    })
    .replace(/<(?:p|caption|td|th)\b[^>]*>([\s\S]*?)<\/(?:p|caption|td|th)>/gi, (_m, c: string) => {
      const text = decodeEntities(stripMarkup(c));
      return text ? `${text}\n\n` : "";
    })
    .replace(/<(?:list-item|li)\b[^>]*>([\s\S]*?)<\/(?:list-item|li)>/gi, (_m, c: string) => {
      const text = decodeEntities(stripMarkup(c));
      return text ? `- ${text}\n` : "";
    });

  const text = cleanupText(stripRemainingTags(normalized));
  return text || null;
}

/**
 * 将 PMC XML 正文片段转换为 Markdown。
 *
 * @param xmlContent PMC XML 正文或章节片段。
 * @returns 转换后的 Markdown；输入为空时返回 null。
 */
export function convertPmcXmlToMarkdown(xmlContent: string): string | null {
  return htmlToMarkdown(xmlContent);
}

/**
 * 对原始 HTML/XML 做预清理，移除声明、注释并标准化换行。
 *
 * @param markup 原始标记字符串。
 * @returns 预处理后的标记字符串。
 */
function normalizeMarkup(markup: string): string {
  return markup
    .replace(/<\?xml[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:body|article|pmc-articleset|front|article-meta|abstract)[^>]*>/gi, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * 将 XML/HTML 标题标签转换为 Markdown 标题。
 *
 * @param markup 预处理后的标记字符串。
 * @returns 替换标题后的字符串。
 */
function convertTitles(markup: string): string {
  return markup
    .replace(/<title\b[^>]*>([\s\S]*?)<\/title>/gi, (_match, title: string) => {
      const text = decodeEntities(stripMarkup(title));
      return text ? `\n\n## ${text}\n\n` : "\n\n";
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, title: string) => {
      const text = decodeEntities(stripMarkup(title));
      return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "\n\n";
    });
}

/**
 * 将段落类标签转换为 Markdown 段落。
 *
 * @param markup 预处理后的标记字符串。
 * @returns 替换段落后的字符串。
 */
function convertParagraphs(markup: string): string {
  return markup
    .replace(
      /<(?:p|caption|td|th)\b[^>]*>([\s\S]*?)<\/(?:p|caption|td|th)>/gi,
      (_match, content: string) => {
        const text = decodeEntities(stripMarkup(content));
        return text ? `${text}\n\n` : "";
      },
    )
    .replace(/<br\s*\/?\s*>/gi, "\n");
}

/**
 * 将列表标签转换为 Markdown 列表。
 *
 * @param markup 预处理后的标记字符串。
 * @returns 替换列表后的字符串。
 */
function convertLists(markup: string): string {
  return markup
    .replace(
      /<(?:list-item|li)\b[^>]*>([\s\S]*?)<\/(?:list-item|li)>/gi,
      (_match, content: string) => {
        const text = decodeEntities(stripMarkup(content));
        return text ? `- ${text}\n` : "";
      },
    )
    .replace(/<\/?(?:list|ul|ol|table|thead|tbody|tr)[^>]*>/gi, "\n");
}

/**
 * 将常见内联标签转换为 Markdown 内联语法。
 *
 * @param markup 预处理后的标记字符串。
 * @returns 替换内联格式后的字符串。
 */
function convertInlineFormatting(markup: string): string {
  return markup
    .replace(/<(?:italic|i|em)\b[^>]*>([\s\S]*?)<\/(?:italic|i|em)>/gi, "*$1*")
    .replace(/<(?:bold|b|strong)\b[^>]*>([\s\S]*?)<\/(?:bold|b|strong)>/gi, "**$1**")
    .replace(/<(?:ext-link|xref|a)\b[^>]*>([\s\S]*?)<\/(?:ext-link|xref|a)>/gi, "$1")
    .replace(/<(?:sub|sup|label|span)\b[^>]*>([\s\S]*?)<\/(?:sub|sup|label|span)>/gi, "$1");
}

/**
 * 去除剩余标记并解码实体。
 *
 * @param markup 已转换过主要结构的字符串。
 * @returns 去标签后的文本。
 */
function stripRemainingTags(markup: string): string {
  return decodeEntities(stripMarkup(markup));
}

/**
 * 清理 Markdown 文本中的多余空白和空行。
 *
 * @param markdown 原始 Markdown 文本。
 * @returns 清理后的 Markdown 文本。
 */
function cleanupMarkdown(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * 清理纯文本中的多余空白和空行。
 *
 * @param text 原始纯文本。
 * @returns 清理后的纯文本。
 */
function cleanupText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * 去除所有 XML/HTML 标签。
 *
 * @param markup 原始标记字符串。
 * @returns 去标签后的文本。
 */
function stripMarkup(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ");
}

/**
 * 解码常见 HTML 实体。
 *
 * @param value 可能含实体的文本。
 * @returns 解码后的文本。
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}
