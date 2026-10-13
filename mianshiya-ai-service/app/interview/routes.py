"""内部面试路由；只受理命令和查询持久化状态，模型调用在后台执行。"""
import asyncio

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse

from .contracts import InterviewCreate, InterviewCommand, SetupJobRequest
from .service import InterviewFailure

router = APIRouter(prefix="/internal/v1/interviews")


@router.get("/catalog")
async def get_catalog(request: Request):
    """目录只含公开设置，无参考答案及用户资料。"""
    from .setup import catalog
    return {"requestId": request.state.request_id, "data": catalog()}


@router.post("/setup-jobs")
async def create_setup_job(body: SetupJobRequest, request: Request):
    """使用已有持久化执行器，不启动不可恢复的内存后台任务。"""
    return await setup_invoke(request, "create", body)


@router.get("/setup-jobs/{job_id}")
async def get_setup_job(job_id: str, request: Request, ownerId: str = Query(pattern=r"^[0-9]{1,20}$")):
    return await setup_invoke(request, "get", job_id, ownerId)


async def setup_invoke(request, operation, *args):
    service = getattr(request.app.state, "interviews", None)
    if service is None or service.stopping:
        return JSONResponse(status_code=503, content={"requestId": request.state.request_id,
                            "error": "INTERVIEW_DISABLED", "message": "面试服务未就绪"})
    try:
        data = await asyncio.to_thread(getattr(service.setup_jobs, operation), *args)
        return {"requestId": request.state.request_id, "data": data}
    except InterviewFailure as exc:
        return JSONResponse(status_code=exc.status, content={"requestId": request.state.request_id,
                            "error": "SETUP_FAILED", "message": exc.message})


async def invoke(request, operation, *args):
    """统一开关、脱敏错误和请求标识；所有数据库工作放在线程中。"""
    service = getattr(request.app.state, "interviews", None)
    if service is None or service.stopping:
        return JSONResponse(status_code=503, content={"requestId": request.state.request_id,
                            "error": "INTERVIEW_DISABLED", "message": "新面试服务尚未启用"})
    try:
        data = await asyncio.to_thread(getattr(service, operation), *args)
        return {"requestId": request.state.request_id, "data": data}
    except InterviewFailure as exc:
        return JSONResponse(status_code=exc.status, content={"requestId": request.state.request_id,
                            "error": "INTERVIEW_CONFLICT", "message": exc.message})


@router.post("")
async def create(body: InterviewCreate, request: Request):
    return await invoke(request, "create", body)


@router.get("")
async def history(request: Request, ownerId: str = Query(pattern=r"^[0-9]{1,20}$")):
    return await invoke(request, "list", ownerId)


@router.get("/{session_id}")
async def get(session_id: str, request: Request, ownerId: str = Query(pattern=r"^[0-9]{1,20}$")):
    return await invoke(request, "get", session_id, ownerId)


@router.post("/{session_id}/commands")
async def command(session_id: str, body: InterviewCommand, request: Request,
                  ownerId: str = Query(pattern=r"^[0-9]{1,20}$")):
    return await invoke(request, "submit", session_id, ownerId, body)
