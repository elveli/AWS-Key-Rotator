import React, { useState } from 'react';
import { Copy, Download, Terminal, Shield, CheckCircle2, AlertTriangle, Key } from 'lucide-react';

export default function App() {
  const [profile, setProfile] = useState('default');
  const [user, setUser] = useState('my-iam-user');
  const [account, setAccount] = useState('123456789012');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [hardcode, setHardcode] = useState(false);
  const [copied, setCopied] = useState(false);

  const getScript = () => {
    if (hardcode) {
      return `#!/usr/bin/env python3
import boto3
import sys
import json
import os
import stat
from botocore.exceptions import ClientError

# --- Configuration ---
AWS_PROFILE = "${profile}"
IAM_USER = "${user}"
AWS_ACCOUNT = "${account}"
DELETE_OLD_IF_FULL = False
NOTIFY_EMAIL = "${notifyEmail}"
SENDER_EMAIL = "${senderEmail}"
# ---------------------

def rotate_keys():
    """
    Rotates AWS IAM access keys for the configured user.
    """
    print(f"Starting key rotation for user '{IAM_USER}' using profile '{AWS_PROFILE}'...\\n")
    
    try:
        # Initialize boto3 session
        session = boto3.Session(profile_name=AWS_PROFILE)
        iam = session.client('iam')
        
        # 1. List existing keys
        response = iam.list_access_keys(UserName=IAM_USER)
        existing_keys = response.get('AccessKeyMetadata', [])
        
        if len(existing_keys) >= 2:
            print(f"â User '{IAM_USER}' already has 2 access keys (the maximum allowed).")
            
            # Sort by CreateDate to find the oldest
            existing_keys = sorted(existing_keys, key=lambda k: k['CreateDate'])
            oldest_key = existing_keys[0]['AccessKeyId']
            
            if DELETE_OLD_IF_FULL:
                print(f"Deleting oldest key: {oldest_key}...")
                iam.delete_access_key(UserName=IAM_USER, AccessKeyId=oldest_key)
                print("â Oldest key deleted successfully.")
                existing_keys = existing_keys[1:]
            else:
                print(f"Oldest key is {oldest_key} created on {existing_keys[0]['CreateDate']}.")
                print("You must delete an existing key before creating a new one.")
                print("Set DELETE_OLD_IF_FULL = True in the script to automate this.")
                sys.exit(1)
                
        # 2. Create new key
        print("Creating new access key...")
        new_key_resp = iam.create_access_key(UserName=IAM_USER)
        new_key = new_key_resp['AccessKey']
        
        masked_secret = "*" * (len(new_key['SecretAccessKey']) - 4) + new_key['SecretAccessKey'][-4:]
        
        print("\\n" + "="*40)
        print("â NEW ACCESS KEY CREATED SUCCESSFULLY")
        print("="*40)
        print(f"Access Key ID     : {new_key['AccessKeyId']}")
        print(f"Secret Access Key : {masked_secret}")
        print("="*40 + "\\n")
        
        creds_file = f"{IAM_USER}_new_keys.json"
        with open(creds_file, 'w') as f:
            json.dump({
                "AccessKeyId": new_key['AccessKeyId'],
                "SecretAccessKey": new_key['SecretAccessKey']
            }, f, indent=4)
        os.chmod(creds_file, stat.S_IRUSR | stat.S_IWUSR)
        print(f"â Credentials securely saved to local file: {creds_file}\\n")
        
        # 3. Securely store and notify
        if NOTIFY_EMAIL and SENDER_EMAIL:
            try:
                region = session.region_name or 'us-east-1'
                secrets_client = session.client('secretsmanager', region_name=region)
                secret_name = f"iam-credentials/{IAM_USER}-{new_key['AccessKeyId']}"
                
                print(f"Storing new credentials in Secrets Manager as '{secret_name}'...")
                secrets_client.create_secret(
                    Name=secret_name,
                    Description=f"Rotated IAM keys for {IAM_USER}",
                    SecretString=json.dumps({
                        "AccessKeyId": new_key['AccessKeyId'],
                        "SecretAccessKey": new_key['SecretAccessKey']
                    })
                )
                
                print(f"Sending notification email to {NOTIFY_EMAIL}...")
                ses_client = session.client('ses', region_name=region)
                console_url = f"https://{region}.console.aws.amazon.com/secretsmanager/secret?name={secret_name}"
                
                subject = "Your AWS IAM Access Key has been rotated"
                body_text = (
                    f"Hello,\\n\\n"
                    f"Your AWS IAM Access Key for user '{IAM_USER}' in account '{AWS_ACCOUNT}' has been rotated.\\n\\n"
                    f"For security reasons, the Secret Access Key is not included in this email.\\n"
                    f"To retrieve your new credentials, please log into the AWS Console and navigate to AWS Secrets Manager:\\n\\n"
                    f"Secret Name: {secret_name}\\n"
                    f"Region: {region}\\n"
                    f"Link: {console_url}\\n\\n"
                    f"Please update your applications and local configuration.\\n"
                )
                
                ses_client.send_email(
                    Source=SENDER_EMAIL,
                    Destination={'ToAddresses': [NOTIFY_EMAIL]},
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
            iam.update_access_key(UserName=IAM_USER, AccessKeyId=old_key_id, Status='Inactive')
            print(f"â Key {old_key_id} is now Inactive.")
            print("  (You can delete it later from the AWS Console once you confirm the new key works)")
            
        print("\\nâ Key rotation complete!")
            
    except ClientError as e:
        print(f"â AWS Error: {e.response['Error']['Message']}")
        sys.exit(1)
    except Exception as e:
        print(f"â Unexpected error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    rotate_keys()
`;
    }

    return `#!/usr/bin/env python3
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
    print(f"Starting key rotation for user '{user_name}' using profile '{profile_name}'...\\n")
    
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
        
        print("\\n" + "="*40)
        print("â NEW ACCESS KEY CREATED SUCCESSFULLY")
        print("="*40)
        print(f"Access Key ID     : {new_key['AccessKeyId']}")
        print(f"Secret Access Key : {masked_secret}")
        print("="*40 + "\\n")
        
        creds_file = f"{user_name}_new_keys.json"
        with open(creds_file, 'w') as f:
            json.dump({
                "AccessKeyId": new_key['AccessKeyId'],
                "SecretAccessKey": new_key['SecretAccessKey']
            }, f, indent=4)
        os.chmod(creds_file, stat.S_IRUSR | stat.S_IWUSR)
        print(f"â Credentials securely saved to local file: {creds_file}\\n")
        
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
                    f"Hello,\\n\\n"
                    f"Your AWS IAM Access Key for user '{user_name}' in account '{account_id}' has been rotated.\\n\\n"
                    f"For security reasons, the Secret Access Key is not included in this email.\\n"
                    f"To retrieve your new credentials, please log into the AWS Console and navigate to AWS Secrets Manager:\\n\\n"
                    f"Secret Name: {secret_name}\\n"
                    f"Region: {region}\\n"
                    f"Link: {console_url}\\n\\n"
                    f"Please update your applications and local configuration.\\n"
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
            
        print("\\nâ Key rotation complete!")
            
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
`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getScript());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([getScript()], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = "rotate_aws_keys.py";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-indigo-500/30">
      <div className="max-w-5xl mx-auto p-6 lg:p-12">
        
        <header className="mb-12 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
            <Key className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">AWS Key Rotator</h1>
            <p className="text-sm text-zinc-500">Generate a secure Python script to rotate IAM access keys</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Configuration */}
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
              <h2 className="text-sm font-medium text-zinc-100 uppercase tracking-wider mb-6 flex items-center gap-2">
                <Terminal className="w-4 h-4" /> Configuration
              </h2>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">Script Style</label>
                  <div className="flex bg-zinc-950 rounded-lg p-1 border border-zinc-800">
                    <button 
                      onClick={() => setHardcode(false)}
                      className={`flex-1 text-xs py-2 rounded-md transition-colors ${!hardcode ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      CLI Arguments
                    </button>
                    <button 
                      onClick={() => setHardcode(true)}
                      className={`flex-1 text-xs py-2 rounded-md transition-colors ${hardcode ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      Hardcoded Values
                    </button>
                  </div>
                </div>

                    {hardcode && (
                      <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">AWS Profile</label>
                          <input 
                            type="text" 
                            value={profile}
                            onChange={(e) => setProfile(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                            placeholder="default"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">IAM Username</label>
                          <input 
                            type="text" 
                            value={user}
                            onChange={(e) => setUser(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                            placeholder="username"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">AWS Account ID</label>
                          <input 
                            type="text" 
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                            placeholder="123456789012"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">Notify Email (Optional)</label>
                          <input 
                            type="email" 
                            value={notifyEmail}
                            onChange={(e) => setNotifyEmail(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                            placeholder="user@example.com"
                          />
                        </div>
                        {notifyEmail && (
                          <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-2">Sender Email (SES Verified)</label>
                            <input 
                              type="email" 
                              value={senderEmail}
                              onChange={(e) => setSenderEmail(e.target.value)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                              placeholder="admin@example.com"
                            />
                          </div>
                        )}
                      </div>
                    )}
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6">
              <h2 className="text-sm font-medium text-zinc-100 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4" /> How it works
              </h2>
              <ul className="space-y-3 text-sm text-zinc-400">
                <li className="flex gap-3">
                  <span className="text-indigo-400 font-mono">1.</span>
                  <span>Connects to AWS using the specified profile.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-indigo-400 font-mono">2.</span>
                  <span>Checks if the user already has 2 access keys (AWS limit).</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-indigo-400 font-mono">3.</span>
                  <span>Creates a new access key, masks it in the console, and saves it to a secure local file.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-indigo-400 font-mono">4.</span>
                  <span>Safely <strong>deactivates</strong> (but does not delete) the old keys.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-indigo-400 font-mono">5.</span>
                  <span>Stores the new key in <strong>Secrets Manager</strong> and emails the user via <strong>SES</strong>.</span>
                </li>
              </ul>
            </div>
            
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="text-sm text-amber-200/80">
                  <p className="font-medium text-amber-500 mb-1">Prerequisites</p>
                  <p>You need Python 3 and the <code className="bg-amber-500/20 px-1 rounded text-amber-400">boto3</code> library installed:</p>
                  <code className="block mt-2 bg-black/30 p-2 rounded border border-amber-500/20 text-amber-400 font-mono text-xs">
                    pip install boto3
                  </code>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Code Preview */}
          <div className="lg:col-span-2 flex flex-col h-[800px]">
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 border-b-0 rounded-t-2xl px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
                  <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
                  <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
                </div>
                <span className="ml-2 text-xs font-mono text-zinc-500">rotate_keys.py</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition-colors cursor-pointer"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button 
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-xs font-medium text-white transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </div>
            </div>
            <div className="flex-1 bg-[#0d0d0d] border border-zinc-800 rounded-b-2xl p-4 overflow-auto relative group">
              <pre className="text-[13px] leading-relaxed font-mono text-zinc-300">
                <code>{getScript()}</code>
              </pre>
            </div>
            
            {!hardcode && (
              <div className="mt-4 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4 shrink-0">
                <p className="text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Usage Example</p>
                <code className="block text-sm font-mono text-indigo-300 break-all">
                  python rotate_keys.py --profile default --user my-iam-user --account 123456789012 --notify-email user@example.com --sender-email admin@example.com
                </code>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
