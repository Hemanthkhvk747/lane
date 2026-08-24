from typing import Literal

from pydantic import BaseModel, Field

from app.models import UserRole

RegisterRole = Literal["customer", "store", "rider"]


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: RegisterRole = "customer"


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    id: int
    email: str
    role: UserRole

    model_config = {"from_attributes": True}


class StoreCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class StorePublic(BaseModel):
    id: int
    name: str
    is_open: bool
    owner_user_id: int

    model_config = {"from_attributes": True}


class MenuItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price_rupees: int = Field(ge=1, le=100000)
    stock: int = Field(ge=0, le=10000)


class MenuItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    price_rupees: int | None = Field(default=None, ge=1, le=100000)
    stock: int | None = Field(default=None, ge=0, le=10000)


class MenuItemPublic(BaseModel):
    id: int
    store_id: int
    name: str
    price_rupees: int
    stock: int

    model_config = {"from_attributes": True}
