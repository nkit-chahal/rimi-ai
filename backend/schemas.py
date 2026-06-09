"""Pydantic request validation schemas for API routes."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class CreditsCheckRequest(BaseModel):
    tool_key: str = Field(alias="toolKey")
    default: int = 1
    quantity: int = 1

    @field_validator("tool_key")
    @classmethod
    def tool_key_not_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("toolKey is required")
        return value


class ProjectPayload(BaseModel):
    project_id: int = Field(default=1, alias="projectId")


class ExtractDesignRequest(ProjectPayload):
    filename: Optional[str] = None
    model_id: str = Field(default="google/nano-banana", alias="modelId")


class UploadMetadata(BaseModel):
    original_name: Optional[str] = Field(default=None, alias="originalName")


class ShareLinkRequest(ProjectPayload):
    export_filename: str = Field(alias="exportFilename")
    expires_days: int = Field(default=7, alias="expiresDays")


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class TeamInviteRequest(BaseModel):
    email: str
    role: Literal["member", "admin"] = "member"
