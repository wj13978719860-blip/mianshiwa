"""共享限流故障必须可理解，不能返回成功或静默放开请求。"""
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.wenjing.adapters.gateway_app import create_gateway_app


def test_redis_error_returns_retryable_503_without_connection_details():
    app = create_gateway_app()

    @app.get("/shared-state-test")
    def fail():
        # 只模拟异常，不停止开发者的真实 Redis。
        raise RedisConnectionError("private connection detail")

    response = TestClient(app).get("/shared-state-test")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "3"
    assert response.json()["detail"]["action"] == "retry_later"
    assert "private connection detail" not in response.text
