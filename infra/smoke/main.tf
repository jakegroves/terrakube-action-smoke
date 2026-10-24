terraform {
  required_version = ">= 1.9.0"
}

resource "terraform_data" "smoke" {
  input = {
    message = var.smoke_message
    regions = var.smoke_regions
  }
}

output "smoke" {
  value = terraform_data.smoke.output
}
