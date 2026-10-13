"""面试蛙基础设施适配层：MySQL、Elasticsearch、MySQL checkpointer、网关鉴权。

上游问镜业务代码通过原有接口（``models.base``、``engine.rag.vectorstore``、
``langgraph_workflow._default_checkpointer``、``get_optional_user``）间接使用这里的实现，
业务文件本身保持与上游一致。
"""
