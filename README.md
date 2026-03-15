# AWS Key Rotator

A Python script generator for securely rotating AWS IAM access keys.

## Features
- **Secure Rotation**: Creates a new key before deactivating the old one.
- **AWS Limits**: Handles the 2-key limit per IAM user.
- **Secrets Manager**: Securely stores the new credentials in AWS Secrets Manager.
- **Email Notification**: Notifies the end-user via AWS SES with instructions on how to retrieve their new key from the AWS Console.

## Prerequisites
- Python 3.x
- `boto3` library (`pip install boto3`)
- AWS credentials configured (`~/.aws/credentials`)
- SES configured and emails verified (if your AWS account is in the SES sandbox)

## Usage
Generate the script using the web interface, then run it:

```bash
python rotate_keys.py --profile default --user my-iam-user --account 123456789012 --notify-email user@example.com --sender-email admin@example.com
```
