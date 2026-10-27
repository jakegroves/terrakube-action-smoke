variable "smoke_message" {
  description = "Nonsecret release input forwarded by the CI workflow."
  type        = string
  default     = "workspace-default-authz-control"

  validation {
    condition     = length(trimspace(var.smoke_message)) > 0
    error_message = "The release message must not be empty."
  }
}

variable "smoke_regions" {
  description = "Regions used to verify forwarding a complex Terraform input."
  type        = list(string)
  default     = []
}
