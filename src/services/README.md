# services 模块说明

该模块封装对各学术数据源与辅助能力的访问。

- 对 Europe PMC、PubMed、arXiv、CrossRef、OpenAlex 等数据源进行统一封装。
- 提供期刊指标、引用关系、全文处理等业务服务。
- 通过服务容器集中管理依赖，降低工具层与具体实现的耦合。
