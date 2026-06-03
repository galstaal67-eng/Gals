from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    subdomain: str  # identifies the tenant


class MFAVerifyRequest(BaseModel):
    mfa_token: str
    code: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class MFARequiredResponse(BaseModel):
    mfa_required: bool = True
    mfa_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class SSOLoginResponse(BaseModel):
    authorize_url: str


class MFASetupResponse(BaseModel):
    secret: str
    provisioning_uri: str


class MFAEnableRequest(BaseModel):
    code: str
