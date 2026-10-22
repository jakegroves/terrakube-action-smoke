variable "smoke_message" {
  type = string

  validation {
    condition     = var.smoke_message == "forwarded-from-github"
    error_message = "The per-run string was not forwarded correctly."
  }
}

variable "smoke_private" {
  type      = string
  sensitive = true

  validation {
    condition     = sha256(var.smoke_private) == var.smoke_digest
    error_message = "The per-run multiline value was not preserved."
  }
}

variable "smoke_digest" {
  type = string
}

variable "smoke_empty" {
  type = string

  validation {
    condition     = var.smoke_empty == ""
    error_message = "The per-run empty string was not preserved."
  }
}

variable "smoke_regions" {
  type = list(string)

  validation {
    condition     = var.smoke_regions == tolist(["eu-west-1", "eu-west-2"])
    error_message = "The per-run list was not forwarded correctly."
  }
}
