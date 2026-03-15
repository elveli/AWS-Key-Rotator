#!/usr/bin/env python3
import boto3
import argparse
import sys
import json
import os
import stat
from botocore.exceptions import ClientError

def rotate_keys(profile_name, user_name, account_id, notify_email, sender_email, delete_old=False):
    """
    Rotates AWS IAM access keys for a given user.
    """
    print(f"Starting key rotation for user '{user_name}' using profile '{profile_name}'...\n")
    
    try:
        # Initialize boto3 session
        session = boto3.Session(profile_name=profile_name)
        iam = session.client('iam')
        
        # 1. List existing keys
        response = iam.list_access_keys(UserName=user_name)
        existing_keys = response.get('AccessKeyMetadata', [])
        
        if len(existing_keys) >= 2:
            print(f"â User '{user_name}' already has 2 access keys (the maximum allowed).")
            print("You must delete an existing key before creating a new one.")
            
            # Sort by CreateDate to find the oldest
            existing_keys = sorted(existing_keys, key=lambda k: k['CreateDate'])
            oldest_key = existing_keys[0]['AccessKeyId']
            
            if delete_old:
                print(f"Deleting oldest key: {oldest_key}...")
                iam.delete_access_key(UserName=user_name, AccessKeyId=oldest_key)
                print("â Oldest key deleted successfully.")
                existing_keys = existing_keys[1:]
            else:
                print(f"Oldest key is {oldest_key} created on {existing_keys[0]['CreateDate']}.")
                print("Run with --delete-old to automatically delete the oldest key.")
                sys.exit(1)
                
        # 2. Create new key
        print("Creating new access key...")
        new_key_resp = iam.create_access_key(UserName=user_name)
        new_key = new_key_resp['AccessKey']
        
        masked_secret = "*" * (len(new_key['SecretAccessKey']) - 4) + new_key['SecretAccessKey'][-4:]
        
        print("\n" + "="*40)
        print("â NEW ACCESS KEY CREATED SUCCESSFULLY")
        print("="*40)
        print(f"Access Key ID     : {new_key['AccessKeyId']}")
        print(f"Secret Access Key : {masked_secret}")
        print("="*40 + "\n")
        
        creds_file = f"{user_name}_new_keys.json"
        with open(creds_file, 'w') as f:
            json.dump({
                "AccessKeyId": new_key['AccessKeyId'],
                "SecretAccessKey": new_key['SecretAccessKey']
            }, f, indent=4)
        os.chmod(creds_file, stat.S_IRUSR | stat.S_IWUSR)
        print(f"â Credentials securely saved to local file: {creds_file}\n")
        
        # 3. Securely store and notify
        if notify_email and sender_email:
            try:
                region = session.region_name or 'us-east-1'
                secrets_client = session.client('secretsmanager', region_name=region)
                secret_name = f"iam-credentials/{user_name}-{new_key['AccessKeyId']}"
                
                print(f"Storing new credentials in Secrets Manager as '{secret_name}'...")
                secrets_client.create_secret(
                    Name=secret_name,
                    Description=f"Rotated IAM keys for {user_name}",
                    SecretString=json.dumps({
                        "AccessKeyId": new_key['AccessKeyId'],
                        "SecretAccessKey": new_key['SecretAccessKey']
                    })
                )
                
                print(f"Sending notification email to {notify_email}...")
                ses_client = session.client('ses', region_name=region)
                console_url = f"https://{region}.console.aws.amazon.com/secretsmanager/secret?name={secret_name}"
                
                subject = "Your AWS IAM Access Key has been rotated"
                body_text = (
                    f"Hello,\n\n"
                    f"Your AWS IAM Access Key for user '{user_name}' in account '{account_id}' has been rotated.\n\n"
                    f"For security reasons, the Secret Access Key is not included in this email.\n"
                    f"To retrieve your new credentials, please log into the AWS Console and navigate to AWS Secrets Manager:\n\n"
                    f"Secret Name: {secret_name}\n"
                    f"Region: {region}\n"
                    f"Link: {console_url}\n\n"
                    f"Please update your applications and local configuration.\n"
                )
                
                ses_client.send_email(
                    Source=sender_email,
                    Destination={'ToAddresses': [notify_email]},
                    Message={
                        'Subject': {'Data': subject},
                        'Body': {'Text': {'Data': body_text}}
                    }
                )
                print("â Notification sent successfully.")
            except Exception as e:
                print(f"â Warning: Failed to store secret or send notification: {e}")
        
        # 4. Deactivate old keys
        for key in existing_keys:
            old_key_id = key['AccessKeyId']
            print(f"Deactivating previous key: {old_key_id}...")
            iam.update_access_key(UserName=user_name, AccessKeyId=old_key_id, Status='Inactive')
            print(f"â Key {old_key_id} is now Inactive.")
            print("  (You can delete it later from the AWS Console once you confirm the new key works)")
            
        print("\nâ Key rotation complete!")
            
    except ClientError as e:
        print(f"â AWS Error: {e.response['Error']['Message']}")
        sys.exit(1)
    except Exception as e:
        print(f"â Unexpected error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Rotate AWS IAM Access Keys securely.')
    parser.add_argument('-p', '--profile', required=True, help='AWS CLI profile name to use for authentication')
    parser.add_argument('-u', '--user', required=True, help='IAM username whose keys will be rotated')
    parser.add_argument('-a', '--account', required=False, default='Unknown', help='AWS Account ID (for notification context)')
    parser.add_argument('-e', '--notify-email', required=False, help='Email address to notify the user')
    parser.add_argument('-s', '--sender-email', required=False, help='Verified SES sender email (required if --notify-email is used)')
    parser.add_argument('--delete-old', action='store_true', help='Automatically delete the oldest key if the user already has 2 keys')
    
    args = parser.parse_args()
    
    if args.notify_email and not args.sender_email:
        parser.error("--sender-email is required when --notify-email is provided")
        
    rotate_keys(args.profile, args.user, args.account, args.notify_email, args.sender_email, args.delete_old)
