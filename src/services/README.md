# services 模块说明

该模块封装对各学术数据源与辅助能力的访问。

**主要用途**：为学术文献与科研论文检索分析提供数据源访问层，重点连接医学、生命科学和跨学科科研数据源。

- 对 Europe PMC、PubMed、arXiv、CrossRef、OpenAlex 等数据源进行统一封装。
- 提供期刊指标、引用关系、全文处理等业务服务。
- 通过服务容器集中管理依赖，降低工具层与具体实现的耦合。

## 外部配置

| 配置                          | 作用                              | 缺失后果                              |
| ----------------------------- | --------------------------------- | ------------------------------------- |
| `OPENALEX_API_KEY`            | OpenAlex 搜索、施引文献、期刊指标 | OpenAlex 相关服务返回配置错误或空指标 |
| `EASYSCHOLAR_SECRET_KEY`      | EasyScholar 影响因子、分区、JCI   | 期刊质量只尝试 OpenAlex 退化路径      |
| `NCBI_EMAIL` / `NCBI_API_KEY` | PubMed/PMC 身份标识与速率         | 无 key 时按 3 req/s 保守限速          |
| `CROSSREF_MAILTO`             | Crossref Polite Pool              | 仍可请求，但不进入 Polite Pool        |
| `SEMANTIC_SCHOLAR_API_KEY`    | Semantic Scholar 施引上下文       | 更容易被限流                          |
