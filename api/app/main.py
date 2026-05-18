import logging
import os

import psycopg2
import redis as redis_lib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth
from app.routers import reports
from app.routers import jobs
from app.routers import dev
from app.routers import protocols
from app.routers import users
from app.routers import fpa
from app.routers import notebook
from app.routers import contacts
from app.routers import advisors
from app.routers import projects
from app.routers import notes
from app.routers import tasks
from app.routers import calendar
from app.routers import planner
from app.routers import crm
from app.routers import drive
from app.routers import funding
from app.routers import dilutive
from app.routers import cap_table
from app.routers import chemicals
from app.routers import invoices
from app.routers import portal
from app.routers import settings as settings_router
from app.routers import agent_manager
from app.routers import notifications
from app.routers import consumables
from app.routers import equipment
from app.routers import email as email_router
from app.routers import messaging
from app.routers import milestones
from app.routers import module_owners
from app.routers import marketing
from app.routers import time_tracking
from app.core.agent_config import _ensure_tables

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app = FastAPI(
    title="Collective ERP API",
    root_path="/api",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(reports.router)
app.include_router(jobs.router)
app.include_router(dev.router, prefix="/dev", tags=["dev"])
app.include_router(protocols.router)
app.include_router(users.router)
app.include_router(fpa.router)
app.include_router(notebook.router)
app.include_router(contacts.router)
app.include_router(advisors.router)
app.include_router(projects.router)
app.include_router(notes.router)
app.include_router(tasks.router)
app.include_router(calendar.router)
app.include_router(planner.router)
app.include_router(crm.router)
app.include_router(drive.router)
app.include_router(funding.router)
app.include_router(dilutive.router)
app.include_router(cap_table.router)
app.include_router(chemicals.router)
app.include_router(invoices.router)
app.include_router(portal.router)
app.include_router(settings_router.router)
app.include_router(agent_manager.router)
app.include_router(notifications.router)
app.include_router(consumables.router)
app.include_router(equipment.router)
app.include_router(email_router.router)
app.include_router(messaging.router)
app.include_router(milestones.router)
app.include_router(module_owners.router)
app.include_router(marketing.router)
app.include_router(time_tracking.router)


@app.on_event("startup")
async def startup_event():
    logger.info("Collective ERP API starting up")
    _ensure_tables()
    module_owners.ensure_table()
    time_tracking.ensure_table()
    users.ensure_users_table()
    users.ensure_user_type_column()
    email_router.ensure_suggestions_user_column()


@app.get("/health")
def health_check():
    db_status = "connected"
    db_error = None
    redis_status = "connected"
    redis_error = None

    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=3)
        conn.close()
    except Exception as e:
        db_status = "error"
        db_error = str(e)

    try:
        r = redis_lib.from_url(os.environ["REDIS_URL"], socket_connect_timeout=3)
        r.ping()
    except Exception as e:
        redis_status = "error"
        redis_error = str(e)

    overall = "ok" if db_status == "connected" and redis_status == "connected" else "degraded"

    response = {"status": overall, "db": db_status, "redis": redis_status}
    if db_error:
        response["db_error"] = db_error
    if redis_error:
        response["redis_error"] = redis_error

    return response
